import { timingSafeEqual } from 'node:crypto';
import { Router } from 'express';
import { asyncHandler } from '../lib/async.js';
import { ApiError } from '../lib/errors.js';
import { logger } from '../logger.js';
import { config } from '../config.js';
import { handlePaymentWebhook } from '../services/payment-service.js';
import { verifyP2CSignature } from '../services/pay2crypto-signature.js';
import { resolveGatewaySettings } from '../services/settings.js';

export const webhooksRouter = Router();

/** Constant-time compare so a secret cannot be guessed byte-by-byte. */
function secretsMatch(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/**
 * Pay2Crypto payment callback.
 *
 * The gateway signs every delivery and says so in the headers:
 *
 *   x-p2c-signature: t=<unix>,v1=<hex hmac>
 *   x-p2c-event:     payment.confirmed
 *   x-p2c-delivery:  evt_…
 *
 * This endpoint used to demand a shared secret in `x-pay2crypto-secret` (or
 * `?secret=`) — a header the gateway never sends. Every real callback was
 * answered 401, so a confirmed payment never moved the ledger and the member's
 * dashboard stayed inactive. The signature is now the primary authentication,
 * and the shared-secret header remains accepted for gateways/configurations
 * that cannot sign.
 *
 * FAILS CLOSED: an unsigned, badly signed, or stale callback is rejected with
 * 401. An unauthenticated callback is an open internet request to credit a
 * wallet, so there is no "trust it anyway" branch here.
 */
webhooksRouter.post(
  '/pay2crypto',
  asyncHandler(async (req, res) => {
    const gw = await resolveGatewaySettings();
    const signatureHeader = req.header('x-p2c-signature');
    const eventHeader = req.header('x-p2c-event');
    const deliveryId = req.header('x-p2c-delivery');
    const rawBody = (req as typeof req & { rawBody?: string }).rawBody;

    let authenticated = false;
    let scheme: string | undefined;

    if (signatureHeader) {
      const result = verifyP2CSignature({
        header: signatureHeader,
        rawBody: rawBody ?? '',
        // The webhook secret first; the merchant token second, for a gateway
        // that signs per-account rather than per-webhook.
        secrets: [gw.webhookSecret, gw.token],
        deliveryId,
        event: eventHeader,
      });
      if (result.ok) {
        authenticated = true;
        scheme = result.scheme;
        logger.info(
          { event: eventHeader, delivery: deliveryId, scheme, skewSeconds: result.skewSeconds },
          'Pay2Crypto callback signature verified',
        );
      } else {
        logger.warn(
          {
            event: eventHeader,
            delivery: deliveryId,
            reason: result.reason,
            skewSeconds: result.skewSeconds,
            rawBodyAvailable: rawBody !== undefined,
            signature: signatureHeader,
          },
          'Pay2Crypto callback signature rejected',
        );
        // Evidence window: the signing string is not published by the vendor,
        // so when nothing matches we log the body (once, and only while the
        // capture hatch is on) to derive the scheme instead of guessing it.
        if (config.PAY2CRYPTO_WEBHOOK_CAPTURE === '1') {
          logger.warn(
            {
              event: eventHeader,
              delivery: deliveryId,
              signature: signatureHeader,
              body: (rawBody ?? '').slice(0, 2000),
            },
            'Pay2Crypto callback body captured for scheme analysis',
          );
        }
      }
    }

    if (!authenticated) {
      // Legacy/shared-secret path, kept for gateways that cannot sign.
      const headerSecret = req.header('x-pay2crypto-secret');
      const querySecret = typeof req.query.secret === 'string' ? req.query.secret : undefined;
      const provided = headerSecret ?? querySecret;
      if (gw.webhookSecret && provided && secretsMatch(provided, gw.webhookSecret)) {
        authenticated = true;
        scheme = 'shared-secret';
      }
    }

    if (!authenticated) {
      throw ApiError.unauthorized('Webhook signature rejected', 'UNAUTHORIZED');
    }

    const result = await handlePaymentWebhook(req.body, { event: eventHeader, deliveryId });
    res.json({ ok: true, auth: scheme, ...result });
  }),
);
