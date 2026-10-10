import nodemailer, { type Transporter } from 'nodemailer';
import { config } from '../config.js';
import { logger } from '../logger.js';

/**
 * Outbound email — hardened Mailgun/SMTP transport.
 *
 * Ported from COPINEX's `services/email.ts` (Mailgun is just an SMTP relay:
 * smtp.mailgun.org / smtp.eu.mailgun.org). Three rules it enforces:
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

/** False = the channel is off; the fan-out records SKIPPED, never FAILED. */
export function emailConfigured(): boolean {
  return config.SMTP_URL.trim().length > 0;
}

function getTransporter(): Transporter | null {
  // The test suite NEVER sends real mail, whatever sits in .env — a suite that
  // hit the live relay on every run would be slow, flaky, and would email
  // fake addresses for real. Same rule as payment mock mode.
  if (!emailConfigured() || config.NODE_ENV === 'test') return null;
  if (!transporter) {
    const url = new URL(config.SMTP_URL);
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
  }
  return transporter;
}

/**
 * Send an email. Without SMTP_URL this is the dev transport: the message is
 * logged and the caller gets the rendered body back, so the flow is testable
 * end-to-end with no mail server. In production a missing transport is a hard
 * error — a platform that silently drops mail is worse than one that won't boot.
 */
export async function sendEmail(
  to: string,
  subject: string,
  text: string,
  html?: string,
): Promise<EmailResult> {
  const t = getTransporter();
  if (!t) {
    logger.info({ to, subject }, `[dev-mail] ${text}`);
    if (config.NODE_ENV === 'production') {
      throw new Error('SMTP_URL is not configured — cannot deliver email in production');
    }
    return { dev: true, body: html ?? text };
  }

  const mail = {
    from: config.SMTP_FROM,
    ...(config.SMTP_REPLY_TO ? { replyTo: config.SMTP_REPLY_TO } : {}),
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Boot-time SMTP check. Connect + authenticate BEFORE the API accepts traffic,
 * so a bad password or unreachable host is a loud crash at deploy time rather
 * than a silent black hole discovered by the first locked-out member.
 *
 * Returns true when there is nothing to check (no SMTP_URL configured).
 */
export async function verifySmtpConnection(): Promise<boolean> {
  const t = getTransporter();
  if (!t) return true;
  await t.verify();
  logger.info('SMTP connection verified');
  return true;
}

/** Build an absolute link to the web app (payment return_url, emails, …). */
export function appUrl(path: string): string {
  return `${config.APP_URL.replace(/\/$/, '')}${path}`;
}
