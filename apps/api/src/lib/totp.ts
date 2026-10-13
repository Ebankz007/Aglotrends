/**
 * TOTP (RFC 6238) — time-based one-time passwords for staff two-factor auth.
 *
 * Implemented against the spec rather than pulled in as a dependency. The whole
 * algorithm is HMAC plus a truncation rule; it sits directly on the
 * authentication path, and a supply-chain compromise here would be a compromise
 * of every admin session. It is small enough to read in one sitting and to test
 * against the RFC's own published vectors.
 *
 * Compatibility: SHA-1, 6 digits, 30-second step — the defaults every
 * authenticator app (Google Authenticator, Authy, 1Password, Bitwarden) assumes
 * when it scans an `otpauth://` URI.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const DIGITS = 6;
const PERIOD_SECONDS = 30;
const ALGORITHM = 'sha1';

/* ------------------------------------------------------------------ base32 */

/** RFC 4648 base32, unpadded — the encoding authenticator apps expect. */
export function base32Encode(input: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of input) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

/**
 * Reverses `base32Encode`. Tolerates the padding and the lowercase/whitespace
 * that people paste out of a password manager, but rejects anything outside the
 * alphabet rather than silently skipping it — a mangled secret should fail
 * loudly, not produce codes that never match.
 */
export function base32Decode(input: string): Buffer {
  const clean = input.replace(/[\s-]/g, '').replace(/=+$/, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of clean) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) throw new Error(`Invalid base32 character: ${char}`);
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/* --------------------------------------------------------------------- totp */

/** A fresh 160-bit seed, base32-encoded. 160 bits is the RFC 4226 recommendation. */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

/**
 * The HOTP core (RFC 4226 §5.3): HMAC the big-endian counter, then take a
 * 4-byte window whose offset is chosen by the low nibble of the last byte. The
 * high bit is masked off so the result is positive regardless of platform
 * signedness.
 */
function hotp(secret: Buffer, counter: number): string {
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));

  const digest = createHmac(ALGORITHM, secret).update(counterBuffer).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary =
    ((digest[offset]! & 0x7f) << 24) |
    ((digest[offset + 1]! & 0xff) << 16) |
    ((digest[offset + 2]! & 0xff) << 8) |
    (digest[offset + 3]! & 0xff);

  return (binary % 10 ** DIGITS).toString().padStart(DIGITS, '0');
}

function counterAt(atMs: number): number {
  return Math.floor(atMs / 1000 / PERIOD_SECONDS);
}

/** The code a given secret produces right now. Exported for tests and tooling. */
export function generateTotpCode(secret: string, atMs: number = Date.now()): string {
  return hotp(base32Decode(secret), counterAt(atMs));
}

/**
 * Constant-time string compare. Both sides are hashed first so the comparison
 * is over equal-length buffers — `timingSafeEqual` throws on a length mismatch,
 * and the length itself is not a secret worth leaking.
 */
function safeEqual(a: string, b: string): boolean {
  const left = createHash('sha256').update(a).digest();
  const right = createHash('sha256').update(b).digest();
  return timingSafeEqual(left, right);
}

export interface VerifyTotpOptions {
  /** Steps either side of now to accept, absorbing clock drift. 1 = ±30s. */
  window?: number;
  /** Injectable clock, for tests. */
  atMs?: number;
}

/**
 * Verifies a user-supplied code.
 *
 * The comparison is constant-time and the window is deliberately narrow: each
 * extra step is another 30 seconds in which a leaked code stays usable.
 */
interface TOTPVerifyOptions {
  window?: number;
  atMs?: number;
}

export function verifyTotpCode(secret: string, token: string, options: TOTPVerifyOptions = {}): boolean {
  const { window = 1, atMs = Date.now() } = options;
  const candidate = token.replace(/[\s-]/g, '');
  if (!/^\d{6}$/.test(candidate)) return false;

  let key: Buffer;
  try {
    key = base32Decode(secret);
  } catch {
    return false;
  }

  const counter = counterAt(atMs);
  let matched = false;
  // Deliberately does not short-circuit: every step in the window is evaluated
  // so the comparison time does not reveal which step matched.
  for (let offset = -window; offset <= window; offset += 1) {
    const expected = Buffer.from(hotp(key, counter + offset));
    const provided = Buffer.from(candidate);
    if (expected.length === provided.length && timingSafeEqual(expected, provided)) {
      matched = true;
    }
  }
  return matched;
}

/* --------------------------------------------------------------- enrolment */

/**
 * The `otpauth://` URI an authenticator app scans. The issuer is repeated in
 * both the label and the query string on purpose: apps disagree about which one
 * to display, and a missing issuer shows up as a bare email in the app's list.
 */
export function buildOtpauthUri(params: { secret: string; account: string; issuer: string }): string {
  const label = encodeURIComponent(`${params.issuer}:${params.account}`);
  const query = new URLSearchParams({
    secret: params.secret,
    issuer: params.issuer,
    algorithm: ALGORITHM.toUpperCase(),
    digits: String(DIGITS),
    period: String(PERIOD_SECONDS),
  });
  return `otpauth://totp/${label}?${query.toString()}`;
}

/* --------------------------------------------------------- recovery codes */

/**
 * Single-use codes that stand in for the second factor when the device is lost.
 * 64 bits of entropy each, grouped for transcription. They are shown to the
 * user exactly once and stored only as hashes.
 */
export function generateRecoveryCodes(count = 10): string[] {
  return Array.from({ length: count }, () => {
    const raw = randomBytes(8).toString('hex');
    return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}`;
  });
}

/** Recovery codes are high-entropy random strings, so a plain SHA-256 is enough. */
export function hashRecoveryCode(code: string): string {
  return createHash('sha256').update(normalizeRecoveryCode(code)).digest('hex');
}

/** Accepts what a human types: any case, spaces or dashes instead of the groups. */
export function normalizeRecoveryCode(code: string): string {
  return code.replace(/[\s-]/g, '').toLowerCase();
}

/**
 * Returns the index of the matching hash, or -1. The caller removes that entry,
 * which is what makes a recovery code single-use.
 */
export function matchRecoveryCode(code: string, hashes: readonly string[]): number {
  const target = Buffer.from(hashRecoveryCode(code));
  let match = -1;
  for (let index = 0; index < hashes.length; index += 1) {
    const stored = Buffer.from(hashes[index]!);
    if (stored.length === target.length && timingSafeEqual(stored, target)) match = index;
  }
  return match;
}
