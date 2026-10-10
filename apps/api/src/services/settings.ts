import { eq } from 'drizzle-orm';
import { config } from '../config.js';
import { db, schema } from '../db.js';
import { decryptSecret, encryptSecret, encryptionAvailable, isEncrypted } from '../lib/crypto.js';

/**
 * Runtime settings, stored in `app_config` (key → jsonb). This is the layer
 * that lets a SUPERADMIN change the platform's behaviour from the console
 * without a redeploy: the payment rail, the marketing copy, and platform
 * switches all resolve through here.
 *
 * Environment variables remain the FALLBACK, never the override — a value set
 * in the console wins. That keeps dev `.env` bootstrapping working while
 * making the console authoritative once an operator touches a field.
 *
 * Secrets (gateway token, webhook secret) live here too, but are WRITE-ONLY
 * from the API's point of view: reads return a boolean "is it set", never the
 * value. Production should move these to a secret manager — noted, not hidden.
 */

/* --------------------------------------------------------------- primitives */

export async function getSetting<T = unknown>(key: string): Promise<T | null> {
  const [row] = await db
    .select({ value: schema.appConfig.value })
    .from(schema.appConfig)
    .where(eq(schema.appConfig.key, key))
    .limit(1);
  return row ? (row.value as T) : null;
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  await db
    .insert(schema.appConfig)
    .values({ key, value: value as Record<string, unknown> })
    .onConflictDoUpdate({
      target: schema.appConfig.key,
      set: { value: value as Record<string, unknown>, updatedAt: new Date() },
    });
}

/* ---------------------------------------------------------- payment gateway */

export const GATEWAY_KEY = 'payment.gateway';

export interface GatewaySettings {
  provider: string;
  apiUrl: string;
  /** The receiving wallet shown to members / used by the rail. */
  walletAddress: string;
  network: string;
  asset: string;
  token: string;
  webhookSecret: string;
  /** Operator override: run the rail in mock mode even when credentials exist. */
  forceMock: boolean;
}

const GATEWAY_DEFAULTS: GatewaySettings = {
  provider: 'pay2crypto',
  apiUrl: '',
  walletAddress: '',
  network: 'trc20',
  asset: 'USDT',
  token: '',
  webhookSecret: '',
  forceMock: false,
};

/** The effective gateway config: stored value first, environment as fallback. */
export async function resolveGatewaySettings(): Promise<GatewaySettings> {
  const stored = (await getSetting<Partial<GatewaySettings>>(GATEWAY_KEY)) ?? {};
  const merged = { ...GATEWAY_DEFAULTS, ...stored };
  return {
    ...merged,
    apiUrl: (merged.apiUrl || config.PAY2CRYPTO_API_URL || '').replace(/\/+$/, ''),
    // Stored values are encrypted at rest; environment values are plaintext.
    token: merged.token ? decryptSecret(merged.token) : config.PAY2CRYPTO_TOKEN || '',
    webhookSecret: merged.webhookSecret
      ? decryptSecret(merged.webhookSecret)
      : config.PAY2CRYPTO_WEBHOOK_SECRET || '',
  };
}

/** Mock mode: no usable credentials, an explicit override, or the test suite. */
export function isGatewayMock(gw: GatewaySettings): boolean {
  return config.NODE_ENV === 'test' || gw.forceMock || !gw.apiUrl || !gw.token;
}

/** Safe read model — never contains the token or webhook secret themselves. */
export interface GatewaySettingsView {
  provider: string;
  apiUrl: string;
  walletAddress: string;
  network: string;
  asset: string;
  forceMock: boolean;
  hasToken: boolean;
  hasWebhookSecret: boolean;
  tokenSource: 'database' | 'environment' | 'unset';
  webhookSecretSource: 'database' | 'environment' | 'unset';
  mockActive: boolean;
  /** False when no SECRET_ENCRYPTION_KEY is configured — secrets are plaintext. */
  secretsEncrypted: boolean;
}

function sourceOf(stored: string | undefined, env: string): 'database' | 'environment' | 'unset' {
  if (stored) return 'database';
  return env ? 'environment' : 'unset';
}

export async function gatewaySettingsView(): Promise<GatewaySettingsView> {
  const stored = (await getSetting<Partial<GatewaySettings>>(GATEWAY_KEY)) ?? {};
  const merged = { ...GATEWAY_DEFAULTS, ...stored };
  // Deliberately does NOT decrypt. The view only needs to know *whether* a
  // secret is set, so a rotated or missing key cannot break the one console an
  // operator needs in order to fix it.
  const effective: GatewaySettings = {
    ...merged,
    apiUrl: (merged.apiUrl || config.PAY2CRYPTO_API_URL || '').replace(/\/+$/, ''),
    token: merged.token || config.PAY2CRYPTO_TOKEN || '',
    webhookSecret: merged.webhookSecret || config.PAY2CRYPTO_WEBHOOK_SECRET || '',
  };
  return {
    provider: effective.provider,
    apiUrl: effective.apiUrl,
    walletAddress: effective.walletAddress,
    network: effective.network,
    asset: effective.asset,
    forceMock: effective.forceMock,
    hasToken: effective.token.length > 0,
    hasWebhookSecret: effective.webhookSecret.length > 0,
    tokenSource: sourceOf(stored.token, config.PAY2CRYPTO_TOKEN),
    webhookSecretSource: sourceOf(stored.webhookSecret, config.PAY2CRYPTO_WEBHOOK_SECRET),
    mockActive: isGatewayMock(effective),
    secretsEncrypted: encryptionAvailable(),
  };
}

export interface GatewaySettingsInput {
  provider?: string;
  apiUrl?: string;
  walletAddress?: string;
  network?: string;
  asset?: string;
  forceMock?: boolean;
  /** undefined = leave unchanged · null = clear (fall back to env) · string = set. */
  token?: string | null;
  webhookSecret?: string | null;
}

export async function saveGatewaySettings(input: GatewaySettingsInput): Promise<GatewaySettingsView> {
  const current = (await getSetting<Partial<GatewaySettings>>(GATEWAY_KEY)) ?? {};
  const next: Partial<GatewaySettings> = { ...current };

  if (input.provider !== undefined) next.provider = input.provider.trim();
  if (input.apiUrl !== undefined) next.apiUrl = input.apiUrl.trim().replace(/\/+$/, '');
  if (input.walletAddress !== undefined) next.walletAddress = input.walletAddress.trim();
  if (input.network !== undefined) next.network = input.network.trim();
  if (input.asset !== undefined) next.asset = input.asset.trim().toUpperCase();
  if (input.forceMock !== undefined) next.forceMock = input.forceMock;
  // A blank string means "clear the override" — the env value (if any) takes
  // over again. `undefined` means "leave whatever is stored alone".
  if (input.token !== undefined) next.token = seal(input.token);
  if (input.webhookSecret !== undefined) next.webhookSecret = seal(input.webhookSecret);

  // Opportunistically upgrade anything written before encryption existed, so
  // legacy plaintext heals on the next save instead of lingering forever.
  if (encryptionAvailable()) {
    if (next.token && !isEncrypted(next.token)) next.token = encryptSecret(next.token);
    if (next.webhookSecret && !isEncrypted(next.webhookSecret)) {
      next.webhookSecret = encryptSecret(next.webhookSecret);
    }
  }

  await setSetting(GATEWAY_KEY, next);
  return gatewaySettingsView();
}

/**
 * Normalises a secret write: blank clears the override, otherwise the value is
 * encrypted. An empty string must NOT be encrypted — that would store a
 * non-empty envelope for "no secret" and make `hasToken` lie.
 */
function seal(value: string | null): string {
  const trimmed = (value ?? '').trim();
  return trimmed ? encryptSecret(trimmed) : '';
}

/* -------------------------------------------------------------- site content */

export const SITE_CONTENT_KEY = 'site.content';

/** Stored marketing-copy overrides. Shape is owned by the web app; the API is
 * a validated JSON store, not a schema authority. */
export async function getSiteContent(): Promise<Record<string, unknown> | null> {
  const value = await getSetting<Record<string, unknown>>(SITE_CONTENT_KEY);
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

export async function saveSiteContent(content: Record<string, unknown>): Promise<void> {
  await setSetting(SITE_CONTENT_KEY, content);
}

/* ------------------------------------------------------------ platform flags */

export const PLATFORM_NAME_KEY = 'platform.name';
export const REGISTRATION_OPEN_KEY = 'platform.registrationOpen';

export interface PlatformSettingsView {
  name: string;
  registrationOpen: boolean;
}

export async function getPlatformSettings(): Promise<PlatformSettingsView> {
  const name = await getSetting<{ name?: string }>(PLATFORM_NAME_KEY);
  const open = await getSetting<{ open?: boolean }>(REGISTRATION_OPEN_KEY);
  return {
    name: name?.name ?? 'Aglotrends',
    registrationOpen: open?.open ?? true,
  };
}

export async function savePlatformSettings(input: {
  name?: string;
  registrationOpen?: boolean;
}): Promise<PlatformSettingsView> {
  if (input.name !== undefined) await setSetting(PLATFORM_NAME_KEY, { name: input.name.trim() });
  if (input.registrationOpen !== undefined) {
    await setSetting(REGISTRATION_OPEN_KEY, { open: input.registrationOpen });
  }
  return getPlatformSettings();
}
