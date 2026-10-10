import { timingSafeEqual } from 'node:crypto';
import { Router } from 'express';
import { config } from '../config.js';
import { asyncHandler } from '../lib/async.js';
import { ApiError } from '../lib/errors.js';
import { handlePaymentWebhook } from '../services/payment-service.js';

export const webhooksRouter = Router();

/** Constant-time compare so a secret cannot be guessed byte-by-byte. */
function secretsMatch(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/**
 * Pay2Crypto payment confirmation. Public by nature (the gateway calls it) —
 * gated by a shared secret sent either as a header or a query param, because
 * some gateway webhook configs cannot send custom headers.
 *
 * Refuses to answer when no secret is configured at all: an unset
 * `PAY2CRYPTO_WEBHOOK_SECRET` must fail closed, never open.
 */
webhooksRouter.post(
  '/pay2crypto',
  asyncHandler(async (req, res) => {
    const headerSecret = req.header('x-pay2crypto-secret');
    const querySecret = typeof req.query.secret === 'string' ? req.query.secret : undefined;
    const provided = headerSecret ?? querySecret;

    if (!config.PAY2CRYPTO_WEBHOOK_SECRET || !provided) {
      throw ApiError.unauthorized('Webhook secret not configured', 'UNAUTHORIZED');
    }
    if (!secretsMatch(provided, config.PAY2CRYPTO_WEBHOOK_SECRET)) {
      throw ApiError.unauthorized('Invalid webhook secret', 'UNAUTHORIZED');
    }

    const result = await handlePaymentWebhook(req.body);
    res.json({ ok: true, ...result });
  }),
);
