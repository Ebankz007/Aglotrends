import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Pay2Crypto is ENVIRONMENT-ONLY, like COPINEX. The console used to be able
 * to write gateway settings into `app_config`, which meant a stray click could
 * point the platform at a different merchant account. These tests pin the
 * contract: the server environment is the only source of truth, and a console
 * write is refused with a clean 403 rather than a 500.
 */

const savedEnv = { ...process.env };

afterEach(() => {
  process.env = { ...savedEnv };
  vi.resetModules();
});

async function loadSettings(env: Record<string, string | undefined>) {
  vi.resetModules();
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  return import('../src/services/settings.js');
}

describe('gatewaySettingsView', () => {
  it('reads the rail from the environment, never from the database', async () => {
    const settings = await loadSettings({
      PAY2CRYPTO_API_URL: 'https://api.pay2crypto.com',
      PAY2CRYPTO_TOKEN: 'tok_env',
      PAY2CRYPTO_WEBHOOK_SECRET: 'whsec_env',
    });

    const view = await settings.gatewaySettingsView();

    expect(view.provider).toBe('pay2crypto');
    expect(view.apiUrl).toBe('https://api.pay2crypto.com');
    expect(view.asset).toBe('USDT');
    expect(view.network).toBe('trc20');
    expect(view.hasToken).toBe(true);
    expect(view.hasWebhookSecret).toBe(true);
    // The source is the environment. A database override is impossible.
    expect(view.tokenSource).toBe('environment');
    expect(view.webhookSecretSource).toBe('environment');
  });

  it('reports unset credentials honestly', async () => {
    const settings = await loadSettings({
      PAY2CRYPTO_API_URL: undefined,
      PAY2CRYPTO_TOKEN: undefined,
      PAY2CRYPTO_WEBHOOK_SECRET: undefined,
    });

    const view = await settings.gatewaySettingsView();

    expect(view.hasToken).toBe(false);
    expect(view.hasWebhookSecret).toBe(false);
    expect(view.tokenSource).toBe('unset');
    expect(view.webhookSecretSource).toBe('unset');
    // No credentials means no live rail.
    expect(view.mockActive).toBe(true);
  });

  it('never leaks a secret value into the view', async () => {
    const settings = await loadSettings({
      PAY2CRYPTO_API_URL: 'https://api.pay2crypto.com',
      PAY2CRYPTO_TOKEN: 'tok_super_secret',
      PAY2CRYPTO_WEBHOOK_SECRET: 'whsec_super_secret',
    });

    const view = await settings.gatewaySettingsView();

    expect(JSON.stringify(view)).not.toContain('tok_super_secret');
    expect(JSON.stringify(view)).not.toContain('whsec_super_secret');
  });
});

describe('saveGatewaySettings', () => {
  it('refuses a console write with a 403, not a 500', async () => {
    // Import the error class from the SAME module registry the service uses —
    // `vi.resetModules()` gives settings.js a fresh copy of errors.js, so the
    // top-level import would not be the same constructor.
    const settings = await loadSettings({});
    const { ApiError } = await import('../src/lib/errors.js');

    await expect(settings.saveGatewaySettings({ provider: 'pay2crypto' })).rejects.toThrow(
      ApiError,
    );
    try {
      await settings.saveGatewaySettings({ provider: 'pay2crypto' });
    } catch (err) {
      expect((err as InstanceType<typeof ApiError>).status).toBe(403);
      expect((err as InstanceType<typeof ApiError>).code).toBe('GATEWAY_SETTINGS_ENV_ONLY');
    }
  });
});
