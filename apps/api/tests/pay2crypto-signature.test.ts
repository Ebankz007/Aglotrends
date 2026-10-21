import { describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import {
  parseP2CSignature,
  secureEqualHex,
  verifyP2CSignature,
} from '../src/services/pay2crypto-signature.js';

/**
 * The Pay2Crypto callback signature, pinned offline.
 *
 * The gateway signs every delivery with `x-p2c-signature: t=<unix>,v1=<hex>`
 * and never sends the shared-secret header this endpoint used to demand —
 * which is why every real callback was answered 401 and a confirmed payment
 * never activated the member's dashboard.
 *
 * The vendor does not publish the signing string, so the verifier tries the
 * candidates and accepts ONLY one whose HMAC reproduces the gateway's `v1`.
 * These tests prove the two properties that matter: a genuine signature
 * passes, and anything else fails.
 */

const SECRET = 'whsec_test_0123456789abcdef';
const NOW = 1_800_000_000_000; // fixed clock, so nothing depends on the wall clock
const TS = Math.floor(NOW / 1000);

function sign(message: string, secret = SECRET): string {
  return createHmac('sha256', secret).update(message, 'utf8').digest('hex');
}

function headerFor(signature: string, timestamp = TS): string {
  return `t=${timestamp},v1=${signature}`;
}

describe('parseP2CSignature', () => {
  it('reads the timestamp and the v1 digest', () => {
    const parsed = parseP2CSignature('t=1792596887,v1=abc123');
    expect(parsed.timestamp).toBe(1792596887);
    expect(parsed.v1).toBe('abc123');
  });

  it('lowercases the digest so comparison is stable', () => {
    expect(parseP2CSignature('t=1,v1=ABCDEF').v1).toBe('abcdef');
  });

  it('is empty rather than throwing on a missing header', () => {
    expect(parseP2CSignature(undefined).v1).toBeUndefined();
    expect(parseP2CSignature('').v1).toBeUndefined();
  });

  it('ignores a malformed timestamp instead of trusting NaN', () => {
    expect(parseP2CSignature('t=not-a-number,v1=abc').timestamp).toBeUndefined();
  });
});

describe('verifyP2CSignature', () => {
  const rawBody = JSON.stringify({ reference: 'AGL-1', status: 'confirmed' });

  it('accepts a genuine signature (timestamp.body)', () => {
    const result = verifyP2CSignature({
      header: headerFor(sign(`${TS}.${rawBody}`)),
      rawBody,
      secrets: [SECRET],
      now: NOW,
    });
    expect(result.ok).toBe(true);
    expect(result.scheme).toContain('ts.body');
  });

  it('accepts a genuine signature over the body alone', () => {
    const result = verifyP2CSignature({
      header: headerFor(sign(rawBody)),
      rawBody,
      secrets: [SECRET],
      now: NOW,
    });
    expect(result.ok).toBe(true);
  });

  it('accepts a genuine signature when the gateway signed re-serialised JSON', () => {
    // The wire body is pretty-printed, but the gateway signed the compact
    // re-serialisation of the same object. The verifier must try that too.
    const pretty = JSON.stringify(JSON.parse(rawBody), null, 2);
    const compact = JSON.stringify(JSON.parse(pretty));
    const result = verifyP2CSignature({
      header: headerFor(sign(`${TS}.${compact}`)),
      rawBody: pretty,
      secrets: [SECRET],
      now: NOW,
    });
    expect(result.ok).toBe(true);
    expect(result.scheme).toContain('canonical');
  });

  it('rejects a tampered body', () => {
    const result = verifyP2CSignature({
      header: headerFor(sign(`${TS}.${rawBody}`)),
      rawBody: JSON.stringify({ reference: 'AGL-1', status: 'confirmed', amount: '999.00' }),
      secrets: [SECRET],
      now: NOW,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('NO_MATCHING_SCHEME');
  });

  it('rejects a signature made with the wrong key', () => {
    const result = verifyP2CSignature({
      header: headerFor(sign(`${TS}.${rawBody}`, 'the-wrong-key')),
      rawBody,
      secrets: [SECRET],
      now: NOW,
    });
    expect(result.ok).toBe(false);
  });

  it('rejects an unsigned callback', () => {
    const result = verifyP2CSignature({ header: undefined, rawBody, secrets: [SECRET], now: NOW });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('NO_SIGNATURE');
  });

  it('rejects a signature with no timestamp', () => {
    const result = verifyP2CSignature({
      header: `v1=${sign(rawBody)}`,
      rawBody,
      secrets: [SECRET],
      now: NOW,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('NO_TIMESTAMP');
  });

  it('rejects a replayed delivery outside the tolerance', () => {
    const stale = TS - 4000;
    const result = verifyP2CSignature({
      header: headerFor(sign(`${stale}.${rawBody}`), stale),
      rawBody,
      secrets: [SECRET],
      now: NOW,
      toleranceSeconds: 600,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('TIMESTAMP_OUT_OF_TOLERANCE');
  });

  it('fails closed when no secret is configured at all', () => {
    const result = verifyP2CSignature({
      header: headerFor(sign(`${TS}.${rawBody}`)),
      rawBody,
      secrets: [],
      now: NOW,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('NO_SECRET');
  });

  it('falls through to the second candidate key', () => {
    const result = verifyP2CSignature({
      header: headerFor(sign(`${TS}.${rawBody}`)),
      rawBody,
      secrets: [undefined, SECRET],
      now: NOW,
    });
    expect(result.ok).toBe(true);
  });
});

describe('secureEqualHex', () => {
  it('is false for a length mismatch and for non-hex input', () => {
    expect(secureEqualHex('abcd', 'abcdef')).toBe(false);
    // Two malformed digests must never compare equal: Buffer.from('zz','hex')
    // is empty, and empty-vs-empty would pass a constant-time compare.
    expect(secureEqualHex('zz', 'zz')).toBe(false);
    expect(secureEqualHex('', '')).toBe(false);
    expect(secureEqualHex('abc', 'abc')).toBe(false);
  });

  it('is true for identical digests', () => {
    expect(secureEqualHex('abcd', 'abcd')).toBe(true);
  });
});
