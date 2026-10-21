import { eq } from 'drizzle-orm';
import { PLATFORM_FEE_CENTS } from '@aglotrends/engine';
import { config } from '../config.js';
import { db, schema } from '../db.js';
import { ApiError } from '../lib/errors.js';
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

/**
 * The rails the merchant account can actually serve, from
 * `PAY2CRYPTO_NETWORKS` (comma separated). Empty means "TRC20 only".
 */
function networksFromEnv(): string[] {
  const raw = (config.PAY2CRYPTO_NETWORKS ?? '').trim();
  if (!raw) return ['trc20'];
  const list = raw
    .split(',')
    .map((n) => n.trim().toLowerCase())
    .filter(Boolean);
  return list.length ? list : ['trc20'];
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

/**
 * The gateway config, resolved from the environment only.
 *
 * Env-only is a deliberate contract, not an omission: the console cannot edit
 * the rail (see `saveGatewaySettings`), so the server environment is the only
 * place the rail is defined. Everything that needs to know "is this mock?"
 * reads THIS function — one source of truth, no second copy to drift.
 */
export function gatewaySettingsFromEnv(): GatewaySettings {
  const networks = networksFromEnv();
  return {
    provider: 'pay2crypto',
    apiUrl: (config.PAY2CRYPTO_API_URL || '').replace(/\/+$/, ''),
    walletAddress: '',
    network: networks[0] ?? 'trc20',
    asset: 'USDT',
    token: config.PAY2CRYPTO_TOKEN || '',
    webhookSecret: config.PAY2CRYPTO_WEBHOOK_SECRET || '',
    forceMock: false,
  };
}

/** The rails the client may offer. The server owns this list. */
export function servedRailList(): string[] {
  return networksFromEnv();
}
/** The effective gateway config: the environment, and nothing else. */
export async function resolveGatewaySettings(): Promise<GatewaySettings> {
  return gatewaySettingsFromEnv();
}

/** Mock mode: no usable credentials, an explicit override, or the test suite. */
export function isGatewayMock(gw: GatewaySettings): boolean {
  return config.NODE_ENV === 'test' || gw.forceMock || !gw.apiUrl || !gw.token;
}

/**
 * Is the rail in mock mode right now? Synchronous, because the answer is
 * needed on hot paths (create/refresh a checkout, label the button).
 */
export function gatewayIsMock(): boolean {
  return isGatewayMock(gatewaySettingsFromEnv());
}

/** Safe read model — never contains the token or webhook secret themselves. */
export interface GatewaySettingsView {
  provider: string;
  apiUrl: string;
  walletAddress: string;
  network: string;
  /** Every rail the account can serve - the client is offered exactly these. */
  networks: string[];
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
  const effective = gatewaySettingsFromEnv();
  return {
    provider: effective.provider,
    apiUrl: effective.apiUrl,
    walletAddress: effective.walletAddress,
    network: effective.network,
    networks: networksFromEnv(),
    asset: effective.asset,
    forceMock: effective.forceMock,
    hasToken: effective.token.length > 0,
    hasWebhookSecret: effective.webhookSecret.length > 0,
    tokenSource: config.PAY2CRYPTO_TOKEN ? 'environment' : 'unset',
    webhookSecretSource: config.PAY2CRYPTO_WEBHOOK_SECRET ? 'environment' : 'unset',
    mockActive: isGatewayMock(effective),
    secretsEncrypted: false,
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

export async function saveGatewaySettings(_input: GatewaySettingsInput): Promise<GatewaySettingsView> {
  // Env-only mode: gateway settings are not editable from console, matching COPINEX.
  // The rail is owned by the server environment, not by a console write.
  throw ApiError.forbidden(
    'Pay2Crypto gateway settings are environment-only. ' +
      'Set PAY2CRYPTO_API_URL, PAY2CRYPTO_TOKEN and PAY2CRYPTO_WEBHOOK_SECRET on the API server, then restart it.',
    'GATEWAY_SETTINGS_ENV_ONLY',
  );
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

/* ------------------------------------------------------- platform fee wallet */

export const PLATFORM_FEE_KEY = 'platform.fees';

/**
 * The operator's transaction-fee configuration. The fee is added to every
 * inbound gateway payment and routed to `walletAddress` — a wallet the
 * SUPERADMIN provides, which is deliberately SEPARATE from the gateway's
 * receiving wallet so platform revenue and member funds never share an address.
 *
 * This address is never returned to members; it appears only in the
 * SUPERADMIN console.
 */
export interface PlatformFeeSettings {
  walletAddress: string;
  network: string;
  asset: string;
  /** Fee in cents. Default $3.00. */
  amountCents: number;
  /** Master switch — when false, no fee is added to any payment. */
  enabled: boolean;
}

const PLATFORM_FEE_DEFAULTS: PlatformFeeSettings = {
  walletAddress: '',
  network: 'trc20',
  asset: 'USDT',
  amountCents: PLATFORM_FEE_CENTS,
  enabled: true,
};

export async function resolvePlatformFeeSettings(): Promise<PlatformFeeSettings> {
  const stored = (await getSetting<Partial<PlatformFeeSettings>>(PLATFORM_FEE_KEY)) ?? {};
  const merged = { ...PLATFORM_FEE_DEFAULTS, ...stored };
  return {
    ...merged,
    amountCents:
      Number.isInteger(merged.amountCents) && merged.amountCents >= 0
        ? merged.amountCents
        : PLATFORM_FEE_CENTS,
  };
}

export interface PlatformFeeSettingsView extends PlatformFeeSettings {
  /** The fee actually applied right now: 0 when disabled. */
  effectiveAmountCents: number;
  /** True when a destination wallet has been configured. */
  walletConfigured: boolean;
}

export async function platformFeeSettingsView(): Promise<PlatformFeeSettingsView> {
  const s = await resolvePlatformFeeSettings();
  return {
    ...s,
    effectiveAmountCents: s.enabled ? s.amountCents : 0,
    walletConfigured: s.walletAddress.trim().length > 0,
  };
}

export async function savePlatformFeeSettings(
  input: Partial<PlatformFeeSettings>,
): Promise<PlatformFeeSettingsView> {
  const current = (await getSetting<Partial<PlatformFeeSettings>>(PLATFORM_FEE_KEY)) ?? {};
  const next: Partial<PlatformFeeSettings> = { ...current };

  if (input.walletAddress !== undefined) next.walletAddress = input.walletAddress.trim();
  if (input.network !== undefined) next.network = input.network.trim();
  if (input.asset !== undefined) next.asset = input.asset.trim().toUpperCase();
  if (input.amountCents !== undefined) {
    next.amountCents = Math.max(0, Math.trunc(input.amountCents));
  }
  if (input.enabled !== undefined) next.enabled = input.enabled;

  await setSetting(PLATFORM_FEE_KEY, next);
  return platformFeeSettingsView();
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

/* ---------------------------------------------------------- integrations */

export const INTEGRATIONS_KEY = 'integrations';

/**
 * Third-party API credentials, editable from the console.
 *
 * Same contract as the payment gateway, deliberately: secrets are encrypted at
 * rest and WRITE-ONLY — a read reports `hasToken`, never the value. Environment
 * variables stay the FALLBACK, so a deployment that never opens this screen
 * behaves exactly as it did before the screen existed.
 *
 * `enabled` is a channel master switch, separate from "configured". Turning a
 * channel off makes the fan-out record SKIPPED, never FAILED — the same
 * distinction the delivery layer already draws for an unconfigured channel.
 */
export type EmailProvider = 'smtp' | 'resend';

export interface EmailIntegrationSettings {
  /** '' = inherit from EMAIL_PROVIDER in the environment. */
  provider: EmailProvider | '';
  enabled: boolean;
  smtpUrl: string;
  resendApiKey: string;
  from: string;
  replyTo: string;
}

export interface WhatsAppIntegrationSettings {
  enabled: boolean;
  /** Cloud API permanent token — encrypted at rest. */
  token: string;
  phoneId: string;
}

export interface TelegramIntegrationSettings {
  enabled: boolean;
  /** Bot token — encrypted at rest. */
  botToken: string;
}

export interface IntegrationsSettings {
  email: EmailIntegrationSettings;
  whatsapp: WhatsAppIntegrationSettings;
  telegram: TelegramIntegrationSettings;
}

const INTEGRATION_DEFAULTS: IntegrationsSettings = {
  email: { provider: '', enabled: true, smtpUrl: '', resendApiKey: '', from: '', replyTo: '' },
  whatsapp: { enabled: true, token: '', phoneId: '' },
  telegram: { enabled: true, botToken: '' },
};

export type SecretSource = 'database' | 'environment' | 'unset';

/** Merge stored overrides over the defaults, without touching the secrets. */
async function storedIntegrations(): Promise<IntegrationsSettings> {
  const stored = (await getSetting<Partial<IntegrationsSettings>>(INTEGRATIONS_KEY)) ?? {};
  return {
    email: { ...INTEGRATION_DEFAULTS.email, ...stored.email },
    whatsapp: { ...INTEGRATION_DEFAULTS.whatsapp, ...stored.whatsapp },
    telegram: { ...INTEGRATION_DEFAULTS.telegram, ...stored.telegram },
  };
}

/** Decrypt a stored secret, falling back to the environment value. */
function reveal(stored: string, fallback: string): string {
  return stored ? decryptSecret(stored) : fallback;
}

/* --- resolved forms, consumed by the delivery layer --- */

export interface ResolvedEmailIntegration {
  provider: EmailProvider;
  enabled: boolean;
  smtpUrl: string;
  resendApiKey: string;
  from: string;
  replyTo: string;
}

export async function resolveEmailIntegration(): Promise<ResolvedEmailIntegration> {
  const s = await storedIntegrations();
  return {
    provider: s.email.provider || config.EMAIL_PROVIDER,
    enabled: s.email.enabled,
    smtpUrl: reveal(s.email.smtpUrl, config.SMTP_URL),
    resendApiKey: reveal(s.email.resendApiKey, config.RESEND_API_KEY),
    from: s.email.from || config.SMTP_FROM,
    replyTo: s.email.replyTo || config.SMTP_REPLY_TO,
  };
}

export interface ResolvedWhatsAppIntegration {
  enabled: boolean;
  token: string;
  phoneId: string;
}

export async function resolveWhatsAppIntegration(): Promise<ResolvedWhatsAppIntegration> {
  const s = await storedIntegrations();
  return {
    enabled: s.whatsapp.enabled,
    token: reveal(s.whatsapp.token, config.WHATSAPP_TOKEN),
    phoneId: s.whatsapp.phoneId || config.WHATSAPP_PHONE_ID,
  };
}

export interface ResolvedTelegramIntegration {
  enabled: boolean;
  botToken: string;
}

export async function resolveTelegramIntegration(): Promise<ResolvedTelegramIntegration> {
  const s = await storedIntegrations();
  return {
    enabled: s.telegram.enabled,
    botToken: reveal(s.telegram.botToken, config.TELEGRAM_BOT_TOKEN),
  };
}

/* --- console read model (never contains a secret) --- */

export interface IntegrationsView {
  email: {
    provider: EmailProvider;
    enabled: boolean;
    from: string;
    replyTo: string;
    hasSmtpUrl: boolean;
    smtpUrlSource: SecretSource;
    hasResendApiKey: boolean;
    resendApiKeySource: SecretSource;
    configured: boolean;
  };
  whatsapp: {
    enabled: boolean;
    phoneId: string;
    hasToken: boolean;
    tokenSource: SecretSource;
    configured: boolean;
  };
  telegram: {
    enabled: boolean;
    hasBotToken: boolean;
    botTokenSource: SecretSource;
    configured: boolean;
  };
  /** False when no SECRET_ENCRYPTION_KEY is configured — secrets are plaintext. */
  secretsEncrypted: boolean;
}

export async function integrationsView(): Promise<IntegrationsView> {
  const s = await storedIntegrations();
  // Deliberately does NOT decrypt: the view only needs to know *whether* a
  // secret is set, so a rotated or missing key cannot break the console an
  // operator needs in order to fix it.
  const provider = s.email.provider || config.EMAIL_PROVIDER;
  const hasSmtpUrl = Boolean(s.email.smtpUrl || config.SMTP_URL);
  const hasResendApiKey = Boolean(s.email.resendApiKey || config.RESEND_API_KEY);
  const hasToken = Boolean(s.whatsapp.token || config.WHATSAPP_TOKEN);
  const hasBotToken = Boolean(s.telegram.botToken || config.TELEGRAM_BOT_TOKEN);
  const phoneId = s.whatsapp.phoneId || config.WHATSAPP_PHONE_ID;
  // "Configured" means the SELECTED provider has its credential — an SMTP URL
  // sitting unused while Resend is selected is not a working email channel.
  const emailReady = provider === 'resend' ? hasResendApiKey : hasSmtpUrl;

  return {
    email: {
      provider,
      enabled: s.email.enabled,
      from: s.email.from || config.SMTP_FROM,
      replyTo: s.email.replyTo || config.SMTP_REPLY_TO,
      hasSmtpUrl,
      smtpUrlSource: sourceOf(s.email.smtpUrl, config.SMTP_URL),
      hasResendApiKey,
      resendApiKeySource: sourceOf(s.email.resendApiKey, config.RESEND_API_KEY),
      configured: s.email.enabled && emailReady,
    },
    whatsapp: {
      enabled: s.whatsapp.enabled,
      phoneId,
      hasToken,
      tokenSource: sourceOf(s.whatsapp.token, config.WHATSAPP_TOKEN),
      configured: s.whatsapp.enabled && hasToken && phoneId.trim().length > 0,
    },
    telegram: {
      enabled: s.telegram.enabled,
      hasBotToken,
      botTokenSource: sourceOf(s.telegram.botToken, config.TELEGRAM_BOT_TOKEN),
      configured: s.telegram.enabled && hasBotToken,
    },
    secretsEncrypted: encryptionAvailable(),
  };
}

export interface IntegrationsInput {
  email?: {
    provider?: EmailProvider;
    enabled?: boolean;
    from?: string;
    replyTo?: string;
    smtpUrl?: string | null;
    resendApiKey?: string | null;
  };
  whatsapp?: { enabled?: boolean; phoneId?: string; token?: string | null };
  telegram?: { enabled?: boolean; botToken?: string | null };
}

/** Opportunistically encrypt a legacy plaintext value on the next save. */
function upgrade(value: string): string {
  return value && !isEncrypted(value) ? encryptSecret(value) : value;
}

export async function saveIntegrations(input: IntegrationsInput): Promise<IntegrationsView> {
  const next = await storedIntegrations();

  if (input.email) {
    if (input.email.provider !== undefined) next.email.provider = input.email.provider;
    if (input.email.enabled !== undefined) next.email.enabled = input.email.enabled;
    if (input.email.from !== undefined) next.email.from = input.email.from.trim();
    if (input.email.replyTo !== undefined) next.email.replyTo = input.email.replyTo.trim();
    if (input.email.smtpUrl !== undefined) next.email.smtpUrl = seal(input.email.smtpUrl);
    if (input.email.resendApiKey !== undefined) {
      next.email.resendApiKey = seal(input.email.resendApiKey);
    }
  }
  if (input.whatsapp) {
    if (input.whatsapp.enabled !== undefined) next.whatsapp.enabled = input.whatsapp.enabled;
    if (input.whatsapp.phoneId !== undefined) next.whatsapp.phoneId = input.whatsapp.phoneId.trim();
    if (input.whatsapp.token !== undefined) next.whatsapp.token = seal(input.whatsapp.token);
  }
  if (input.telegram) {
    if (input.telegram.enabled !== undefined) next.telegram.enabled = input.telegram.enabled;
    if (input.telegram.botToken !== undefined) next.telegram.botToken = seal(input.telegram.botToken);
  }

  if (encryptionAvailable()) {
    next.email.smtpUrl = upgrade(next.email.smtpUrl);
    next.email.resendApiKey = upgrade(next.email.resendApiKey);
    next.whatsapp.token = upgrade(next.whatsapp.token);
    next.telegram.botToken = upgrade(next.telegram.botToken);
  }

  await setSetting(INTEGRATIONS_KEY, next);
  return integrationsView();
}

/* ------------------------------------------------------------ social links */

export const SOCIAL_KEY = 'site.social';

export interface SocialLink {
  id: string;
  /** Stable key used to pick the icon — e.g. `x`, `instagram`, `telegram`. */
  platform: string;
  label: string;
  url: string;
  /** Display handle, e.g. `@aglotrends`. Optional. */
  handle: string;
  enabled: boolean;
  sortOrder: number;
}

export interface SocialSettings {
  links: SocialLink[];
}

/** Public read: ENABLED links only, in display order. */
export async function getSocialSettings(): Promise<SocialSettings> {
  const all = await getSocialSettingsAdmin();
  return { links: all.links.filter((l) => l.enabled) };
}

/** Console read: every link, including hidden ones. */
export async function getSocialSettingsAdmin(): Promise<SocialSettings> {
  const stored = await getSetting<Partial<SocialSettings>>(SOCIAL_KEY);
  const links = Array.isArray(stored?.links) ? stored!.links! : [];
  return { links: [...links].sort((a, b) => a.sortOrder - b.sortOrder) };
}

export async function saveSocialSettings(input: SocialSettings): Promise<SocialSettings> {
  const links = input.links.map((l, i) => ({
    id: l.id,
    platform: l.platform.trim(),
    label: l.label.trim(),
    url: l.url.trim(),
    handle: l.handle.trim(),
    enabled: l.enabled,
    sortOrder: Number.isFinite(l.sortOrder) ? l.sortOrder : i,
  }));
  await setSetting(SOCIAL_KEY, { links });
  return getSocialSettingsAdmin();
}
