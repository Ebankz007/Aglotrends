import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Pay2Crypto callback signature verification.
 *
 * WHAT THE GATEWAY ACTUALLY SENDS (captured from the live rail, 2026-10-21):
 *
 *   POST /api/webhooks/pay2crypto
 *   user-agent: Pay2Crypto-Webhooks/1.0
 *   x-p2c-event: payment.confirmed
 *   x-p2c-delivery: evt_2a398e78206600a270b97fc78353f53e
 *   x-p2c-signature: t=1792596887,v1=b5e88909eb06a394a948f512cf558c87b5be7a319e51dce26c27a2a695027c88
 *
 * The header is Stripe-shaped: `t=<unix seconds>,v1=<hex hmac>`. It is NOT a
 * shared secret in a header — an earlier version of this endpoint demanded
 * `x-pay2crypto-secret` (or `?secret=`), a field the gateway never sends, so
 * every real callback was answered 401. The member paid, the gateway
 * confirmed, the ledger never moved, and the dashboard stayed inactive.
 *
 * SIGNING STRING (pinned from live resend evt_688602ff858d019104b4c49e0f855aee,
 * 2026-10-22): `HMAC-SHA256(webhook_secret, "${timestamp}.${rawBody}")` where
 * `rawBody` is the exact bytes received (no re-serialisation). The verifier
 * still tries candidate schemes as a defence in depth, but the live path is
 * `ts.body + raw body`.
 */

export interface ParsedP2CSignature {
  /** Unix seconds from `t=`. */
  timestamp?: number;
  /** The `v1` hex digest. */
  v1?: string;
  /** Any other version key present (`v0`, `v2`, …). */
  version?: string;
  /** The header exactly as received. */
  raw: string;
}

/**
 * Parse `t=1792596887,v1=<hex>`. Tolerates a bare `v1=<hex>`, spaces, and
 * extra keys. Returns an empty object (not an exception) for a missing or
 * malformed header — the caller decides what to do with "no signature".
 */
export function parseP2CSignature(header: string | undefined | null): ParsedP2CSignature {
  const raw = (header ?? '').trim();
  if (!raw) return { raw: '' };
  const result: ParsedP2CSignature = { raw };
  for (const part of raw.split(',')) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key === 't') {
      const n = Number(value);
      if (Number.isFinite(n)) result.timestamp = n;
    } else if (key === 'v1') {
      result.v1 = value.toLowerCase();
    } else if (key.startsWith('v')) {
      result.version = value;
    }
  }
  return result;
}

/**
 * The candidate signing strings, in the order they are tried.
 *
 * `ts.body` is first because the header format is Stripe's and Stripe signs
 * `${timestamp}.${rawBody}`. The rest are the shapes the other gateways in
 * this family use, so a vendor that signs differently still authenticates —
 * and, critically, a payload that matches NONE of them is rejected.
 */
export const SIGNING_SCHEMES = [
  'ts.body',
  'body',
  'ts+body',
  'body.ts',
  'v1.ts.body',
  'ts:body',
  'ts\\nbody',
  'delivery.ts.body',
  'ts.delivery.body',
  'delivery.body',
  'ts.event.body',
  'event.ts.body',
] as const;

export type SigningScheme = (typeof SIGNING_SCHEMES)[number];

/**
 * The bytes that get signed. The gateway may sign the exact bytes it sent, or
 * a re-serialisation of the same JSON (key order preserved, whitespace
 * removed). Both are tried.
 */
export type BodyVariant = 'raw' | 'canonical';

function canonicalise(rawBody: string): string | null {
  try {
    return JSON.stringify(JSON.parse(rawBody));
  } catch {
    return null;
  }
}

function signingString(
  scheme: SigningScheme,
  parts: { timestamp: string; body: string; deliveryId?: string; event?: string },
): string {
  switch (scheme) {
    case 'ts.body':
      return `${parts.timestamp}.${parts.body}`;
    case 'body':
      return parts.body;
    case 'ts+body':
      return `${parts.timestamp}${parts.body}`;
    case 'body.ts':
      return `${parts.body}.${parts.timestamp}`;
    case 'v1.ts.body':
      return `v1.${parts.timestamp}.${parts.body}`;
    case 'ts:body':
      return `${parts.timestamp}:${parts.body}`;
    case 'ts\\nbody':
      return `${parts.timestamp}\n${parts.body}`;
    case 'delivery.ts.body':
      return `${parts.deliveryId ?? ''}.${parts.timestamp}.${parts.body}`;
    case 'ts.delivery.body':
      return `${parts.timestamp}.${parts.deliveryId ?? ''}.${parts.body}`;
    case 'delivery.body':
      return `${parts.deliveryId ?? ''}.${parts.body}`;
    case 'ts.event.body':
      return `${parts.timestamp}.${parts.event ?? ''}.${parts.body}`;
    case 'event.ts.body':
      return `${parts.event ?? ''}.${parts.timestamp}.${parts.body}`;
  }
}

function hmacHex(secret: string, message: string): string {
  return createHmac('sha256', secret).update(message, 'utf8').digest('hex');
}

/**
 * Constant-time comparison of two hex digests.
 *
 * The hex is VALIDATED first. `Buffer.from('zz', 'hex')` is an empty buffer,
 * so comparing two malformed digests without checking would report them as
 * EQUAL — an attacker could then forge a signature by sending any
 * non-hexadecimal string. A digest that is not valid hex can never be a
 * match, and says so.
 */
export function secureEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length || a.length === 0) return false;
  if (!/^[0-9a-f]+$/.test(a) || !/^[0-9a-f]+$/.test(b)) return false;
  if (a.length % 2 !== 0) return false;
  try {
    return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
  } catch {
    return false;
  }
}

export interface VerifySignatureInput {
  /** The raw `x-p2c-signature` header. */
  header: string | undefined | null;
  /** The exact request body bytes, as received. */
  rawBody: string;
  /**
   * Candidate keys, most likely first. The webhook secret comes first; the
   * API token is tried second because a gateway that signs per-account (rather
   * than per-webhook) would use the account credential.
   */
  secrets: (string | undefined | null)[];
  /** The `x-p2c-delivery` id, for schemes that bind it. */
  deliveryId?: string;
  /** The `x-p2c-event` name, for schemes that bind it. */
  event?: string;
  /** Now, in unix milliseconds. Injectable so the tests are not clock-bound. */
  now?: number;
  /** How far the timestamp may drift, in seconds. Default 600. */
  toleranceSeconds?: number;
}

export interface VerifySignatureResult {
  ok: boolean;
  /** The scheme that matched — the answer to "what does Pay2Crypto sign?" */
  scheme?: string;
  /** Why it failed, when it failed. */
  reason?: string;
  /** Seconds of drift between the signed timestamp and now. */
  skewSeconds?: number;
}

/**
 * Verify a Pay2Crypto callback signature.
 *
 * FAILS CLOSED. An absent header, a missing timestamp, a timestamp outside the
 * tolerance, or no matching scheme all return `ok: false`. There is no
 * "unsigned but trusted" branch: an unauthenticated callback is a request
 * from anybody on the internet to credit a wallet.
 */
export function verifyP2CSignature(input: VerifySignatureInput): VerifySignatureResult {
  const parsed = parseP2CSignature(input.header);
  if (!parsed.v1) return { ok: false, reason: 'NO_SIGNATURE' };
  if (parsed.timestamp === undefined) return { ok: false, reason: 'NO_TIMESTAMP' };

  const nowMs = input.now ?? Date.now();
  const tolerance = input.toleranceSeconds ?? 600;
  const skewSeconds = Math.abs(nowMs / 1000 - parsed.timestamp);
  if (skewSeconds > tolerance) {
    // A stale timestamp is a replay, not a late delivery.
    return { ok: false, reason: 'TIMESTAMP_OUT_OF_TOLERANCE', skewSeconds };
  }

  const secrets = (input.secrets ?? []).filter(
    (s): s is string => typeof s === 'string' && s.length > 0,
  );
  if (secrets.length === 0) return { ok: false, reason: 'NO_SECRET', skewSeconds };

  const timestamp = String(parsed.timestamp);
  const bodyVariants: { name: BodyVariant; body: string }[] = [
    { name: 'raw', body: input.rawBody },
  ];
  const canonical = canonicalise(input.rawBody);
  if (canonical !== null && canonical !== input.rawBody) {
    bodyVariants.push({ name: 'canonical', body: canonical });
  }

  for (const secret of secrets) {
    for (const variant of bodyVariants) {
      for (const scheme of SIGNING_SCHEMES) {
        const message = signingString(scheme, {
          timestamp,
          body: variant.body,
          deliveryId: input.deliveryId,
          event: input.event,
        });
        if (secureEqualHex(hmacHex(secret, message), parsed.v1)) {
          return {
            ok: true,
            scheme: `${scheme} + ${variant.name} body`,
            skewSeconds,
          };
        }
      }
    }
  }

  return { ok: false, reason: 'NO_MATCHING_SCHEME', skewSeconds };
}
