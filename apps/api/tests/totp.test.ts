import { describe, expect, it } from 'vitest';
import {
  base32Decode,
  base32Encode,
  buildOtpauthUri,
  generateRecoveryCodes,
  generateTotpCode,
  generateTotpSecret,
  hashRecoveryCode,
  matchRecoveryCode,
  normalizeRecoveryCode,
  verifyTotpCode,
} from '../src/lib/totp.js';

/**
 * The RFC 6238 Appendix B vectors use the ASCII seed "12345678901234567890".
 * The RFC prints 8-digit codes; ours are 6, which is the same truncated value
 * modulo 10^6 — i.e. the last six digits of the published code.
 */
const RFC_SECRET = base32Encode(Buffer.from('12345678901234567890', 'ascii'));

describe('base32', () => {
  it('encodes the RFC 6238 seed exactly as the spec does', () => {
    expect(base32Encode(Buffer.from('12345678901234567890'))).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
  });

  it('round-trips arbitrary bytes', () => {
    const bytes = Buffer.from([0x00, 0xff, 0x10, 0x7a, 0x99, 0x01, 0x42]);
    expect(base32Decode(base32Encode(bytes)).equals(bytes)).toBe(true);
  });

  it('tolerates padding, lowercase and grouping', () => {
    expect(base32Decode('gezd gnbv-gy3t qojq====').length).toBe(10);
  });

  it('rejects characters outside the alphabet', () => {
    expect(() => base32Decode('GEZD1NBV')).toThrow(/Invalid base32/);
  });
});

describe('generateTotpCode', () => {
  // RFC 6238 Appendix B, SHA-1 column, truncated to 6 digits.
  const vectors: Array<[number, string]> = [
    [59, '287082'],
    [1111111109, '081804'],
    [1111111111, '050471'],
    [1234567890, '005924'],
    [2000000000, '279037'],
    [20000000000, '353130'],
  ];

  it.each(vectors)('matches the RFC vector at t=%i', (seconds, expected) => {
    expect(generateTotpCode(RFC_SECRET, seconds * 1000)).toBe(expected);
  });

  it('produces a 6-digit, zero-padded code', () => {
    expect(generateTotpCode(generateTotpSecret())).toMatch(/^\d{6}$/);
  });

  it('is stable within a 30-second step and changes across one', () => {
    const secret = generateTotpSecret();
    // Align to a step boundary first, or "+29s" can land in the next step.
    const stepStart = 1_700_000_000_000 - (1_700_000_000_000 % 30_000);
    expect(generateTotpCode(secret, stepStart)).toBe(generateTotpCode(secret, stepStart + 29_000));
    expect(generateTotpCode(secret, stepStart)).not.toBe(generateTotpCode(secret, stepStart + 30_000));
  });
});

describe('verifyTotpCode', () => {
  const secret = generateTotpSecret();
  const now = 1_700_000_000_000;

  it('accepts the current code', () => {
    expect(verifyTotpCode(secret, generateTotpCode(secret, now), { atMs: now })).toBe(true);
  });

  it('accepts a code one step either side (clock drift)', () => {
    expect(verifyTotpCode(secret, generateTotpCode(secret, now - 30_000), { atMs: now })).toBe(true);
    expect(verifyTotpCode(secret, generateTotpCode(secret, now + 30_000), { atMs: now })).toBe(true);
  });

  it('rejects a code two steps away', () => {
    expect(verifyTotpCode(secret, generateTotpCode(secret, now - 60_000), { atMs: now })).toBe(false);
  });

  it('rejects a drifted code when the window is closed', () => {
    const drifted = generateTotpCode(secret, now - 30_000);
    expect(verifyTotpCode(secret, drifted, { atMs: now, window: 0 })).toBe(false);
  });

  it('rejects a wrong code, a short code and a non-numeric token', () => {
    expect(verifyTotpCode(secret, '000000', { atMs: now })).toBe(false);
    expect(verifyTotpCode(secret, '12345', { atMs: now })).toBe(false);
    expect(verifyTotpCode(secret, 'abcdef', { atMs: now })).toBe(false);
  });

  it('ignores spacing in a pasted code', () => {
    const code = generateTotpCode(secret, now);
    expect(verifyTotpCode(secret, `${code.slice(0, 3)} ${code.slice(3)}`, { atMs: now })).toBe(true);
  });

  it('returns false rather than throwing on a corrupt secret', () => {
    expect(verifyTotpCode('not!base32', '123456', { atMs: now })).toBe(false);
  });
});

describe('buildOtpauthUri', () => {
  it('encodes issuer, account and parameters', () => {
    const uri = buildOtpauthUri({ secret: 'ABCDEF', account: 'ops@aglotrends.com', issuer: 'Aglotrends' });
    expect(uri.startsWith('otpauth://totp/Aglotrends%3Aops%40aglotrends.com?')).toBe(true);
    const params = new URLSearchParams(uri.split('?')[1]);
    expect(params.get('secret')).toBe('ABCDEF');
    expect(params.get('issuer')).toBe('Aglotrends');
    expect(params.get('digits')).toBe('6');
    expect(params.get('period')).toBe('30');
    expect(params.get('algorithm')).toBe('SHA1');
  });
});

describe('recovery codes', () => {
  it('generates the requested count, uniquely and in a readable shape', () => {
    const codes = generateRecoveryCodes(10);
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const code of codes) expect(code).toMatch(/^[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}$/);
  });

  it('matches a code against its hash regardless of formatting', () => {
    const [code] = generateRecoveryCodes(1);
    const hashes = [hashRecoveryCode(code!)];
    expect(matchRecoveryCode(code!, hashes)).toBe(0);
    expect(matchRecoveryCode(code!.toUpperCase().replace(/-/g, ' '), hashes)).toBe(0);
  });

  it('returns the index so the caller can consume it', () => {
    const codes = generateRecoveryCodes(3);
    const hashes = codes.map(hashRecoveryCode);
    expect(matchRecoveryCode(codes[2]!, hashes)).toBe(2);
  });

  it('returns -1 for a code that is not in the set', () => {
    const hashes = generateRecoveryCodes(3).map(hashRecoveryCode);
    expect(matchRecoveryCode('dead-beef-dead-beef', hashes)).toBe(-1);
  });

  it('never stores the code itself', () => {
    const [code] = generateRecoveryCodes(1);
    expect(hashRecoveryCode(code!)).not.toContain(normalizeRecoveryCode(code!));
  });
});
