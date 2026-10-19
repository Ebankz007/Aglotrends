import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../lib/async.js';
import { requireAuth } from '../lib/auth.js';
import { createUserSubscription } from '../services/subscriptions.js';

export const subscriptionsRouter = Router();
subscriptionsRouter.use(requireAuth);

const createSchema = z.object({
  providerId: z.string().uuid(),
  planId: z.string().uuid().optional(),
  priceCents: z.number().int().positive(),
  interval: z.enum(['MONTHLY','6MONTH','YEARLY']),
  currency: z.string().default('USD'),
});

subscriptionsRouter.post('/create', asyncHandler(async (req, res) => {
  const body = createSchema.parse(req.body);
  const userId = req.user!.id;
  const sub = await createUserSubscription({
    userId,
    providerId: body.providerId,
    planId: body.planId,
    priceCents: body.priceCents,
    currency: body.currency,
    interval: body.interval,
  });
  res.status(201).json({ subscription: sub });
}));
