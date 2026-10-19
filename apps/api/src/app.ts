import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import { config } from './config.js';
import { logger } from './logger.js';
import { errorHandler, notFoundHandler } from './lib/errors.js';
import { authRouter } from './routes/auth.js';
import { twoFactorRouter } from './routes/two-factor.js';
import { meRouter } from './routes/me.js';
import { networkRouter } from './routes/network.js';
import { walletRouter } from './routes/wallet.js';
import { signalsRouter } from './routes/signals.js';
import { brokersRouter } from './routes/brokers.js';
import { adminRouter } from './routes/admin.js';
import { subscriptionsRouter } from './routes/subscriptions.js';
import { paymentsRouter } from './routes/payments.js';
import { contentRouter } from './routes/content.js';
import { kycRouter } from './routes/kyc.js';
import { educationRouter } from './routes/education.js';
import { eventsRouter } from './routes/events.js';
import { supportRouter } from './routes/support.js';
import { adminContentRouter } from './routes/admin-content.js';
import { webhooksRouter } from './routes/webhooks.js';

export function createApp(): express.Express {
  const app = express();

  app.use(helmet());
  app.use(cors({ origin: config.WEB_ORIGIN, credentials: true }));
  app.use(express.json({ limit: '1mb' }));
  app.use(pinoHttp({ logger }));

  app.get('/health', (_req, res) => {
    res.json({ ok: true, service: 'aglotrends-api' });
  });

  app.use('/api/auth', authRouter);
  app.use('/api/auth/2fa', twoFactorRouter);
  app.use('/api/me', meRouter);
  app.use('/api/network', networkRouter);
  app.use('/api/wallet', walletRouter);
  app.use('/api/signals', signalsRouter);
  app.use('/api/brokers', brokersRouter);
  app.use('/api/subscriptions', subscriptionsRouter);
  app.use('/api/admin', adminRouter);
  app.use('/api/admin', adminContentRouter);
  app.use('/api/content', contentRouter);
  app.use('/api/kyc', kycRouter);
  app.use('/api/education', educationRouter);
  app.use('/api/events', eventsRouter);
  app.use('/api/support', supportRouter);
  app.use('/api/payments', paymentsRouter);
  app.use('/api/webhooks', webhooksRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
