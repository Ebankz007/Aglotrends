import { createApp } from './app.js';
import { config } from './config.js';
import { logger } from './logger.js';
import { pool } from './db.js';
import { verifyEmailConnection } from './notifications/email.js';

const app = createApp();
const server = app.listen(config.API_PORT, () => {
  logger.info(`Aglotrends API listening on http://localhost:${config.API_PORT}`);
});

/**
 * Verify the email provider before we say we're ready.
 *
 * NOT fatal, in any environment. A dead mailer is a degraded feature; exiting
 * takes the whole product down - logins, wallet, payments - over password
 * resets that do not arrive. The failure is logged at fatal level (it IS
 * serious), surfaced in the admin console, and the operator can confirm
 * payments by hand in the meantime.
 *
 * The payment rail, by contrast, IS fatal at boot (see config.ts): that one
 * is about money.
 */
void verifyEmailConnection().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  logger.error(
    { err: message },
    'Email verification failed — email delivery is broken, but the API stays up. Password resets will not arrive until email is configured.',
  );
});

function shutdown(signal: string): void {
  logger.info(`${signal} received — shutting down`);
  server.close(() => {
    void pool.end().finally(() => process.exit(0));
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
