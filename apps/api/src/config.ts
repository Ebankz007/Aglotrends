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

  // Notification channels — blank disables the channel (fan-out no-ops safely).
  WHATSAPP_TOKEN: z.string().optional().default(''),
  WHATSAPP_PHONE_ID: z.string().optional().default(''),
  TELEGRAM_BOT_TOKEN: z.string().optional().default(''),

  // Pay2Crypto rail (non-custodial, TRC20 USDT). Blank = mock mode: a synthetic
  // checkout URL is issued so the whole flow is testable with no merchant token.
  PAY2CRYPTO_API_URL: z.string().optional().default(''),
  PAY2CRYPTO_TOKEN: z.string().optional().default(''),
  PAY2CRYPTO_WEBHOOK_SECRET: z.string().optional().default(''),
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
  return config.NODE_ENV === 'test' || !config.PAY2CRYPTO_API_URL || !config.PAY2CRYPTO_TOKEN;
}

/**
 * Production guard — refuse to boot on dev-only values. A placeholder secret in
 * production means forgeable tokens; a mock payment rail in production means
 * fake checkouts; a missing SMTP means silently dropped reset emails. All three
 * are worse than a loud crash at deploy time.
 */
if (config.NODE_ENV === 'production') {
  const offenders: string[] = [];
  if (config.JWT_SECRET === 'dev-only-secret-change-me') offenders.push('JWT_SECRET');
  if (config.PAY2CRYPTO_WEBHOOK_SECRET === '') offenders.push('PAY2CRYPTO_WEBHOOK_SECRET');
  if (offenders.length > 0) {
    // eslint-disable-next-line no-console
    console.error(
      `Refusing to boot in production with dev/placeholder values: ${offenders.join(', ')} — generate real secrets (openssl rand -base64 48).`,
    );
    process.exit(1);
  }
  if (!config.PAY2CRYPTO_API_URL || !config.PAY2CRYPTO_TOKEN) {
    // eslint-disable-next-line no-console
    console.error(
      'Refusing to boot in production without the Pay2Crypto rail (PAY2CRYPTO_API_URL + PAY2CRYPTO_TOKEN). Mock mode is for development only.',
    );
    process.exit(1);
  }
  if (!config.SMTP_URL) {
    // eslint-disable-next-line no-console
    console.error(
      'Refusing to boot in production without SMTP_URL. Format: smtps://user:password@host:465 (password percent-encoded).',
    );
    process.exit(1);
  }
  if (!config.SECRET_ENCRYPTION_KEY) {
    // eslint-disable-next-line no-console
    console.error(
      'Refusing to boot in production without SECRET_ENCRYPTION_KEY — gateway secrets would be stored in plaintext. Generate one with: openssl rand -base64 32',
    );
    process.exit(1);
  }
}
