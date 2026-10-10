import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * `crypto.ts` reads the key from the frozen `config` module, so each case
 * re-imports the module after stubbing the environment. `vi.resetModules()`
 * is what makes the second import a fresh evaluation rather than a cache hit.
 */

const KEY_B64 = Buffer.alloc(32, 7).toString('base64');

type CryptoModule = typeof import('../src/lib/crypto.js');

async function loadCrypto(secretKey = KEY_B64): Promise<CryptoModule> {
  vi.resetModules();
  vi.stubEnv('SECRET_ENCRYPTION_KEY', secretKey);
  return import('../src/lib/crypto.js');
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('encryptSecret / decryptSecret', () => {
  it('round-trips a secret', async () => {
    const { encryptSecret, decryptSecret } = await loadCrypto();
    const sealed = encryptSecret('merchant-token-abc123');
    expect(sealed).not.toContain('merchant-token-abc123');
    expect(decryptSecret(sealed)).toBe('merchant-token-abc123');
  });

  it('uses a fresh IV so the same plaintext encrypts differently', async () => {
    const { encryptSecret } = await loadCrypto();
    expect(encryptSecret('same')).not.toBe(encryptSecret('same'));
  });

  it('reports encryption as available when a key is set', async () => {
    const { encryptionAvailable } = await loadCrypto();
    expect(encryptionAvailable()).toBe(true);
  });

  it('marks an encrypted value with the envelope prefix', async () => {
    const { encryptSecret, isEncrypted } = await loadCrypto();
    expect(isEncrypted(encryptSecret('x'))).toBe(true);
    expect(isEncrypted('plain')).toBe(false);
  });

  it('accepts a hex key as well as base64', async () => {
    const { encryptSecret, decryptSecret } = await loadCrypto(Buffer.alloc(32, 3).toString('hex'));
    expect(decryptSecret(encryptSecret('hex-key'))).toBe('hex-key');
  });

  it('stores plaintext unchanged when no key is configured', async () => {
    const { encryptSecret, encryptionAvailable } = await loadCrypto('');
    expect(encryptionAvailable()).toBe(false);
    expect(encryptSecret('legacy')).toBe('legacy');
  });

  it('passes a legacy plaintext value through decrypt', async () => {
    const { decryptSecret } = await loadCrypto();
    expect(decryptSecret('not-encrypted')).toBe('not-encrypted');
  });

  it('refuses to decrypt when the key is missing', async () => {
    const withKey = await loadCrypto();
    const sealed = withKey.encryptSecret('secret');
    const withoutKey = await loadCrypto('');
    expect(() => withoutKey.decryptSecret(sealed)).toThrow(withoutKey.SecretDecryptionError);
  });

  it('rejects a tampered ciphertext rather than returning garbage', async () => {
    const { encryptSecret, decryptSecret, SecretDecryptionError } = await loadCrypto();
    const parts = encryptSecret('original').split(':');
    const ct = Buffer.from(parts[3] ?? '', 'base64');
    ct[0] = (ct[0] ?? 0) ^ 0xff;
    const tampered = [parts[0], parts[1], parts[2], ct.toString('base64')].join(':');
    expect(() => decryptSecret(tampered)).toThrow(SecretDecryptionError);
  });

  it('rejects a malformed envelope', async () => {
    const { decryptSecret, SecretDecryptionError } = await loadCrypto();
    expect(() => decryptSecret('v1:only-two-parts')).toThrow(SecretDecryptionError);
  });
});
