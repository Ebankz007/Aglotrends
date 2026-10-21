import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().positive().default(4000),
  WEB_ORIGIN: z.string().default('http://localhost:3000'),
  /** Public base URL — used to build absolute outbound links (payment return_url). */
  APP_URL: z.string().url().default('http://localhost:3000'),
  // Dedicated `aglotrends` role — NOT copinex (separated 2026-10-10).
  // Passwordless default — no credential in source; set DATABASE_URL in `.env`.
  DATABASE_URL: z.string().default('postgresql://aglotrends@localhost:5433/aglotrends'),
  JWT_SECRET: z.string().min(8).default('dev-only-secret-change-me'),
  SESSION_TTL_HOURS: z.coerce.number().int().positive().default(24),

  // Encrypts gateway secrets (merchant token, webhook secret) at rest in
  // `app_config`. Accepts hex (64 chars) or base64, decoding to exactly 32 bytes.
  // Blank = secrets stored in plaintext, which is dev-only: production refuses
  // to boot without this. Generate one with: openssl rand -base64 32
  SECRET_ENCRYPTION_KEY: z
    .string()
    .default('')
    .refine(
      (v) => {
        if (v === '') return true;
        const buf = /^[0-9a-fA-F]{64}$/.test(v) ? Buffer.from(v, 'hex') : Buffer.from(v, 'base64');
        return buf.length === 32;
      },
      {
        message:
          'SECRET_ENCRYPTION_KEY must decode to 32 bytes — generate with: openssl rand -base64 32',
      },
    ),

  // Outbound email. Blank = dev transport (message logged, nothing sent).
  // The scheme is validated here so a bare hostname fails at boot with a clear
  // message instead of silently failing deep inside nodemailer at send time.
  SMTP_URL: z
    .string()
    .optional()
    .default('')
    .refine((v) => v === '' || v.startsWith('smtp://') || v.startsWith('smtps://'), {
      message: 'SMTP_URL must start with smtp:// or smtps:// (or be empty to disable)',
    }),
  SMTP_FROM: z.string().default('Aglotrends <no-reply@aglotrends.com>'),
  SMTP_REPLY_TO: z.string().optional().default(''),

  // Which transport sends mail: 'smtp' (any relay — Mailgun, SMTP.com, …) or
  // 'resend' (Resend's HTTP API). The console can override this per-deployment;
  // the environment value is the fallback, matching every other integration.
  EMAIL_PROVIDER: z.enum(['smtp', 'resend']).default('smtp'),
  // Resend API key (re_…). Blank disables the Resend provider.
  RESEND_API_KEY: z.string().optional().default(''),

  // Notification channels — blank disables the channel (fan-out no-ops safely).
  WHATSAPP_TOKEN: z.string().optional().default(''),
  WHATSAPP_PHONE_ID: z.string().optional().default(''),
  TELEGRAM_BOT_TOKEN: z.string().optional().default(''),

  // Pay2Crypto rail (non-custodial, TRC20 USDT). Blank = mock mode: a synthetic
  // checkout URL is issued so the whole flow is testable with no merchant token.
  PAY2CRYPTO_API_URL: z.string().optional().default(''),
  PAY2CRYPTO_TOKEN: z.string().optional().default(''),
  PAY2CRYPTO_WEBHOOK_SECRET: z.string().optional().default(''),

  /**
   * Diagnostic hatch. '1' logs the raw body of a callback whose signature we
   * could not verify, so the signing scheme can be derived from evidence
   * instead of guesswork. Off by default and meant to be a short window: the
   * body carries our own invoice reference, amount and tx hash — no
   * credentials — but it is still a production log.
   */
  PAY2CRYPTO_WEBHOOK_CAPTURE: z.string().optional().default('0'),

     // The USDT rails the merchant account can actually serve, comma
     // separated. A rail the gateway has no receiving address for is refused
     // by the gateway, so offering it would break the member's payment —
     // the client is only ever offered what the account can settle.
     PAY2CRYPTO_NETWORKS: z.string().optional().default(''),

  // Review-deploy hatch — set ALLOW_MOCK_RAIL=true ONLY on a deployment that
  // must never take real money. It lets production boot with the mock payment
  // rail and without SMTP so the site is reviewable before live credentials
  // exist. The API logs a loud warning at boot while this is on.
  ALLOW_MOCK_RAIL: z
    .string()
    .optional()
    .default('')
    .refine((v) => v === '' || v === 'true' || v === 'false', {
      message: 'ALLOW_MOCK_RAIL must be "true" or "false" (or empty)',
    }),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error('Invalid environment configuration:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = parsed.data;
export type Config = typeof config;

/** Mock mode: no credentials, or the test suite — never hits the live rail. */
export function isPaymentMockMode(): boolean {
  return (
    config.NODE_ENV === 'test' ||
    config.ALLOW_MOCK_RAIL === 'true' ||
    !config.PAY2CRYPTO_API_URL ||
    !config.PAY2CRYPTO_TOKEN
  );
}

/**
 * Production guard — refuse to boot on dev-only values. A placeholder secret in
 * production means forgeable tokens; a mock payment rail in production means
 * fake checkouts; a missing SMTP means silently dropped reset emails. All three
 * are worse than a loud crash at deploy time.
 *
 * The ALLOW_MOCK_RAIL hatch suspends the rail + SMTP checks for a review-only
 * deployment. JWT/encryption checks stay enforced — the hatch is about missing
 * third-party credentials, never about weak secrets.
 */
if (config.NODE_ENV === 'production') {
  const mockRail = config.ALLOW_MOCK_RAIL === 'true';
  if (mockRail) {
    // eslint-disable-next-line no-console
    console.warn(
      'ALLOW_MOCK_RAIL=true — booting WITHOUT the live Pay2Crypto rail and WITHOUT SMTP. Review-only deployment: never take real money while this is on.',
    );
  }
  const offenders: string[] = [];
  if (config.JWT_SECRET === 'dev-only-secret-change-me') offenders.push('JWT_SECRET');
  if (!mockRail && config.PAY2CRYPTO_WEBHOOK_SECRET === '')
    offenders.push('PAY2CRYPTO_WEBHOOK_SECRET');
  if (offenders.length > 0) {
    // eslint-disable-next-line no-console
    console.error(
      `Refusing to boot in production with dev/placeholder values: ${offenders.join(', ')} — generate real secrets (openssl rand -base64 48).`,
    );
    process.exit(1);
  }
  if (!mockRail && (!config.PAY2CRYPTO_API_URL || !config.PAY2CRYPTO_TOKEN)) {
    // eslint-disable-next-line no-console
    console.error(
      'Refusing to boot in production without the Pay2Crypto rail (PAY2CRYPTO_API_URL + PAY2CRYPTO_TOKEN). Mock mode is for development only.',
    );
    process.exit(1);
  }
  const emailReady =
    config.EMAIL_PROVIDER === 'resend' ? Boolean(config.RESEND_API_KEY) : Boolean(config.SMTP_URL);
  if (!mockRail && !emailReady) {
    // NOT fatal. Email is resolved from the console first (app_config
    // `integrations`) with the environment as a fallback, and config.ts runs
    // before the database is reachable - so this check cannot see the real
    // state. Making it fatal took the whole site down over a missing
    // password-reset mailer while the rail was live. The payment rail check
    // above stays fatal: that one is about money, and it IS env-only.
    // eslint-disable-next-line no-console
    console.error(
      'No email transport in the environment (SMTP_URL / RESEND_API_KEY). The console may still have one - the delivery layer resolves the console first. If password resets do not arrive, configure email in the console.',
    );
  }
  if (!config.SECRET_ENCRYPTION_KEY) {
    // eslint-disable-next-line no-console
    console.error(
      'Refusing to boot in production without SECRET_ENCRYPTION_KEY — gateway secrets would be stored in plaintext. Generate one with: openssl rand -base64 32',
    );
    process.exit(1);
  }
}
