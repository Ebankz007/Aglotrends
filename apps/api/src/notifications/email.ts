import nodemailer, { type Transporter } from 'nodemailer';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { resolveEmailIntegration, type ResolvedEmailIntegration } from '../services/settings.js';

export type { ResolvedEmailIntegration };

/**
 * Outbound email — two transports behind one interface: SMTP (Mailgun and most
 * providers are plain SMTP relays) and Resend's HTTP API. The provider is chosen
 * per-deployment in the console; `sendEmail` dispatches on it.
 *
 * The SMTP path is ported from COPINEX's `services/email.ts`. Three rules it
 * enforces:
 *
 *  1. The URL is PARSED explicitly rather than handed to nodemailer as a
 *     string, so socket timeouts become first-class typed options and a
 *     malformed URL fails here with a clear message — not deep inside the
 *     transport at send time.
 *  2. A dead host fails in seconds, never hangs a request for minutes.
 *  3. Only TRANSIENT failures are retried. Auth failures and 5xx rejections
 *     never heal, so they fail immediately with a message naming the fix.
 */

export interface EmailResult {
  dev: boolean;
  body: string;
}

let transporter: Transporter | null = null;
/** The URL the cached transporter was built from, so a console change rebuilds it. */
let transporterUrl = '';

/**
 * Resolve the SMTP config from the console, falling back to the environment.
 * The fan-out resolves this once per run and passes it down, rather than each
 * recipient re-reading `app_config`.
 */
export async function emailConfig(): Promise<ResolvedEmailIntegration> {
  return resolveEmailIntegration();
}

/** False = the channel is off; the fan-out records SKIPPED, never FAILED. */
export function emailConfigured(cfg: ResolvedEmailIntegration): boolean {
  if (!cfg.enabled) return false;
  return cfg.provider === 'resend'
    ? cfg.resendApiKey.trim().length > 0
    : cfg.smtpUrl.trim().length > 0;
}

function getTransporter(cfg: ResolvedEmailIntegration): Transporter | null {
  // The test suite NEVER sends real mail, whatever sits in .env — a suite that
  // hit the live relay on every run would be slow, flaky, and would email
  // fake addresses for real. Same rule as payment mock mode.
  if (!emailConfigured(cfg) || config.NODE_ENV === 'test') return null;
  // Rebuild when an operator changes the SMTP URL in the console.
  if (transporter && transporterUrl === cfg.smtpUrl) return transporter;

  let url: URL;
  try {
    url = new URL(cfg.smtpUrl);
  } catch {
    throw new Error('SMTP URL is malformed — expected smtps://user:pass@host:465');
  }
  const secure = url.protocol === 'smtps:';
  transporter = nodemailer.createTransport({
    host: url.hostname,
    port: url.port ? Number(url.port) : secure ? 465 : 587,
    secure,
    auth: url.username
      ? { user: decodeURIComponent(url.username), pass: decodeURIComponent(url.password) }
      : undefined,
    // A dead host must fail in seconds, not hang the request for minutes.
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
  });
  // The pool emits async 'error' events (dropped connections) that would
  // otherwise crash the process as unhandled. Log them; sendMail/verify
  // still report failures through their own rejections.
  transporter.on('error', (err) => {
    logger.error({ err: err instanceof Error ? err.message : String(err) }, 'SMTP pool error');
  });
  transporterUrl = cfg.smtpUrl;
  return transporter;
}

/**
 * Send an email. With no SMTP transport configured this is the dev transport:
 * the message is logged and the caller gets the rendered body back, so the flow
 * is testable end-to-end with no mail server. In production a missing transport
 * is a hard error — a platform that silently drops mail is worse than one that
 * won't boot.
 *
 * Pass `cfg` when fanning out to many recipients, so the settings read happens
 * once rather than per address.
 */
export async function sendEmail(
  to: string,
  subject: string,
  text: string,
  html?: string,
  cfg?: ResolvedEmailIntegration,
): Promise<EmailResult> {
  const resolved = cfg ?? (await emailConfig());
  // The test suite NEVER sends real mail, whatever sits in .env — a suite that
  // hit the live relay on every run would be slow, flaky, and would email fake
  // addresses for real. Same rule as payment mock mode. This single guard
  // covers BOTH transports, so adding a provider cannot open a live-send hole.
  if (!emailConfigured(resolved) || config.NODE_ENV === 'test') {
    logger.info({ to, subject }, `[dev-mail] ${text}`);
    if (config.NODE_ENV === 'production') {
      throw new Error('Email is not configured — cannot deliver email in production');
    }
    return { dev: true, body: html ?? text };
  }

  if (resolved.provider === 'resend') {
    return sendViaResend(resolved, to, subject, text, html);
  }
  return sendViaSmtp(resolved, to, subject, text, html);
}

/**
 * SMTP delivery. The transport is pooled and rebuilt only when the URL changes.
 */
async function sendViaSmtp(
  resolved: ResolvedEmailIntegration,
  to: string,
  subject: string,
  text: string,
  html?: string,
): Promise<EmailResult> {
  const t = getTransporter(resolved);
  if (!t) {
    // Defensive: sendEmail() already verified the channel is configured and
    // that we are not in the test suite, so this is unreachable in practice.
    return { dev: true, body: html ?? text };
  }

  const mail = {
    from: resolved.from,
    ...(resolved.replyTo ? { replyTo: resolved.replyTo } : {}),
    to,
    subject,
    text,
    ...(html ? { html } : {}),
  };

  const delays = [1000, 3000];
  for (let attempt = 1; ; attempt++) {
    try {
      await t.sendMail(mail);
      if (attempt > 1) logger.info({ to, attempt }, 'email delivered after retry');
      return { dev: false, body: html ?? text };
    } catch (err) {
      if (isPermanentSmtpFailure(err) || attempt > delays.length) {
        throw new Error(describeSmtpFailure(err, to), { cause: err });
      }
      logger.warn(
        { to, attempt, nextRetryMs: delays[attempt - 1] },
        'email send transient failure — retrying',
      );
      await sleep(delays[attempt - 1]!);
    }
  }
}

/**
 * Auth failures and 5xx rejections cannot be fixed by waiting.
 * Everything else (dropped connections, timeouts, 4xx/greylisting) may heal.
 */
function isPermanentSmtpFailure(err: unknown): boolean {
  const code = (err as { code?: unknown }).code;
  if (code === 'EAUTH') return true;
  const responseCode = (err as { responseCode?: unknown }).responseCode;
  return typeof responseCode === 'number' && responseCode >= 500;
}

/** Translate nodemailer errors into messages that name the fix, not the symptom. */
function describeSmtpFailure(err: unknown, to: string): string {
  const code = (err as { code?: unknown }).code;
  if (code === 'EAUTH') {
    return `SMTP authentication failed sending to ${to} — check the SMTP credentials (Mailgun: regenerate the per-domain SMTP password; SMTP.com: sender password, not the account password)`;
  }
  if (code === 'ECONNECTION' || code === 'ETIMEDOUT' || code === 'ESOCKET') {
    return `SMTP connection to the mail host failed sending to ${to} — check host/port/TLS combo (587 STARTTLS vs 465 implicit TLS) and outbound firewall`;
  }
  const response = (err as { response?: unknown }).response;
  const detail = typeof response === 'string' ? `: ${response.slice(0, 160)}` : '';
  return `Email to ${to} was rejected by the mail server${detail}`;
}

/**
 * Resend's HTTP API. A single POST — stateless, no pool to keep warm. Retries
 * mirror the SMTP path: 429 and 5xx are transient; 4xx (bad key, unverified
 * sending domain) is permanent and surfaced with a message that names the fix.
 */
async function sendViaResend(
  cfg: ResolvedEmailIntegration,
  to: string,
  subject: string,
  text: string,
  html?: string,
): Promise<EmailResult> {
  const body = {
    from: cfg.from,
    to: [to],
    subject,
    text,
    ...(html ? { html } : {}),
    ...(cfg.replyTo ? { reply_to: cfg.replyTo } : {}),
  };

  const delays = [1000, 3000];
  for (let attempt = 1; ; attempt++) {
    let res: Response;
    try {
      res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${cfg.resendApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (err) {
      if (attempt > delays.length) {
        throw new Error(
          `Resend request failed sending to ${to} — check outbound access to api.resend.com`,
          { cause: err },
        );
      }
      logger.warn({ to, attempt }, 'Resend request failed — retrying');
      await sleep(delays[attempt - 1]!);
      continue;
    }

    if (res.ok) {
      if (attempt > 1) logger.info({ to, attempt }, 'email delivered after retry');
      return { dev: false, body: html ?? text };
    }

    const detail = await readErrorBody(res);
    if (!isRetryableStatus(res.status) || attempt > delays.length) {
      throw new Error(describeResendFailure(res.status, detail, to));
    }
    logger.warn({ to, attempt, status: res.status }, 'Resend rejected — retrying');
    await sleep(delays[attempt - 1]!);
  }
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

async function readErrorBody(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 200);
  } catch {
    return '';
  }
}

export function describeResendFailure(status: number, detail: string, to: string): string {
  const suffix = detail ? `: ${detail}` : '';
  const d = detail.toLowerCase();

  // Resend overloads 403: it means "domain not verified", "testing sender",
  // AND "key inactive". The status alone cannot tell them apart — the message
  // can. Guessing here sends an operator to rotate a working key while the
  // real fault is a pending DNS record.
  if (status === 403) {
    if (d.includes('not verified') || d.includes('verify a domain')) {
      return `Resend refused ${to} — the From domain is not verified yet. Add its DNS records in Resend, wait for verification, then retry${suffix}`;
    }
    if (d.includes('testing emails')) {
      return `Resend refused ${to} — onboarding@resend.dev can only send to your own address. Verify a domain and use it as the From address${suffix}`;
    }
    if (d.includes('not active') || d.includes('suspended')) {
      return `Resend rejected the API key sending to ${to} — create a new key in the Resend dashboard${suffix}`;
    }
    return `Resend returned 403 for ${to} — either the API key is inactive or the From domain is unverified${suffix}`;
  }
  if (status === 401) {
    return `Resend rejected the API key sending to ${to} — check RESEND_API_KEY (it starts with re_)${suffix}`;
  }
  if (status === 422) {
    return `Resend rejected the message sending to ${to} — check the From address and required fields${suffix}`;
  }
  if (status === 429) {
    return `Resend rate limit hit sending to ${to} — 10 requests/second per team; retry later${suffix}`;
  }
  return `Resend returned HTTP ${status} sending to ${to}${suffix}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Boot-time email check. Authenticate BEFORE the API accepts traffic, so a bad
 * key or unreachable host is a loud crash at deploy time rather than a silent
 * black hole discovered by the first locked-out member.
 *
 * Returns true when there is nothing to check (no provider configured).
 */
export async function verifyEmailConnection(): Promise<boolean> {
  const cfg = await emailConfig();
  // The test suite never touches the network — same rule as sendEmail.
  if (!emailConfigured(cfg) || config.NODE_ENV === 'test') return true;
  if (cfg.provider === 'resend') {
    // A cheap authenticated GET validates the key without sending mail.
    const res = await fetch('https://api.resend.com/domains', {
      headers: { Authorization: `Bearer ${cfg.resendApiKey}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      throw new Error(
        `Resend verification failed (HTTP ${res.status}) — check RESEND_API_KEY and that a sending domain is verified`,
      );
    }
    logger.info('Resend connection verified');
    return true;
  }
  const t = getTransporter(cfg);
  if (!t) return true;
  await t.verify();
  logger.info('SMTP connection verified');
  return true;
}

/** Build an absolute link to the web app (payment return_url, emails, …). */
export function appUrl(path: string): string {
  return `${config.APP_URL.replace(/\/$/, '')}${path}`;
}
