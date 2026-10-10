import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { config } from '../config.js';

/**
 * Envelope encryption for the few values that must be *stored* and *used*
 * rather than merely verified: the payment gateway's merchant token and its
 * webhook secret. Both live in `app_config`, and both are worthless to an
 * attacker who can read the database — but the webhook secret is not: it is
 * the only thing standing between an arbitrary POST and a credited wallet.
 *
 * AES-256-GCM, so the ciphertext is authenticated: a tampered value fails to
 * decrypt rather than silently decrypting to garbage.
 *
 * The key comes from `SECRET_ENCRYPTION_KEY` and never from the database. That
 * is the point — a database dump alone is not enough to recover a secret. This
 * is deliberately not a secret manager: the key still lives in the environment.
 * When there is a KMS or a vault, swap the two functions below and nothing
 * else changes.
 */

const PREFIX = 'v1';
const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;

export class SecretDecryptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SecretDecryptionError';
  }
}

/** The 32-byte key, or null when none is configured. */
function key(): Buffer | null {
  const raw = config.SECRET_ENCRYPTION_KEY;
  if (!raw) return null;
  return /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
}

/** True when a key is configured, so secrets are written encrypted. */
export function encryptionAvailable(): boolean {
  return key() !== null;
}

/** True when a value carries the encrypted envelope. */
export function isEncrypted(value: string): boolean {
  return value.startsWith(`${PREFIX}:`);
}

/**
 * Encrypts to `v1:<iv>:<tag>:<ciphertext>` (base64 parts).
 *
 * With no key configured the plaintext is returned unchanged — the caller
 * decides whether that is acceptable. In production it is not: `config.ts`
 * refuses to boot without a key, so this branch is reachable only in dev.
 */
export function encryptSecret(plaintext: string): string {
  const k = key();
  if (!k) return plaintext;
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, k, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    PREFIX,
    iv.toString('base64'),
    tag.toString('base64'),
    ciphertext.toString('base64'),
  ].join(':');
}

/**
 * Reverses `encryptSecret`.
 *
 * A value that is *not* in the envelope is returned as-is: that is the legacy
 * path for secrets written before encryption existed, and it keeps such a value
 * usable rather than silently dropping it. A value that *is* encrypted but
 * cannot be decrypted throws — never returns empty — because an empty secret
 * would quietly downgrade the gateway to mock mode instead of failing loudly.
 */
export function decryptSecret(stored: string): string {
  if (!isEncrypted(stored)) return stored;

  const k = key();
  if (!k) {
    throw new SecretDecryptionError(
      'A stored secret is encrypted but SECRET_ENCRYPTION_KEY is not set. Restore the key, or clear the secret from the console.',
    );
  }

  const parts = stored.split(':');
  if (parts.length !== 4) throw new SecretDecryptionError('Malformed encrypted secret.');

  const iv = Buffer.from(parts[1]!, 'base64');
  const tag = Buffer.from(parts[2]!, 'base64');
  const ciphertext = Buffer.from(parts[3]!, 'base64');
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
    throw new SecretDecryptionError('Malformed encrypted secret.');
  }

  try {
    const decipher = createDecipheriv(ALGORITHM, k, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch {
    throw new SecretDecryptionError(
      'Could not decrypt a stored secret — the value or the encryption key has changed.',
    );
  }
}
