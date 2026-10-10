import { createApp } from './app.js';
import { config } from './config.js';
import { logger } from './logger.js';
import { pool } from './db.js';
import { verifySmtpConnection } from './notifications/email.js';

const app = createApp();
const server = app.listen(config.API_PORT, () => {
  logger.info(`Aglotrends API listening on http://localhost:${config.API_PORT}`);
});

/**
 * Verify SMTP before we say we're ready. In production a dead relay is a hard
 * crash at boot; in development it's a loud warning, because a dev machine with
 * no outbound SMTP must still be able to run the API.
 */
void verifySmtpConnection().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  if (config.NODE_ENV === 'production') {
    logger.fatal({ err: message }, 'SMTP verification failed — refusing to serve traffic');
    process.exit(1);
  }
  logger.warn({ err: message }, 'SMTP verification failed (non-fatal in development)');
});

function shutdown(signal: string): void {
  logger.info(`${signal} received — shutting down`);
  server.close(() => {
    void pool.end().finally(() => process.exit(0));
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
