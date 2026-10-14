import { Router } from 'express';
import { z } from 'zod';
import { asc, desc, eq } from 'drizzle-orm';
import { db, schema } from '../db.js';
import { asyncHandler } from '../lib/async.js';
import { ApiError } from '../lib/errors.js';
import { requireActiveMember, requireAuth } from '../lib/auth.js';

export const brokersRouter = Router();
brokersRouter.use(requireAuth, requireActiveMember);

/** The list of broker links the admin maintains. */
brokersRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const rows = await db
      .select()
      .from(schema.brokerLinks)
      .where(eq(schema.brokerLinks.isActive, true))
      .orderBy(asc(schema.brokerLinks.sortOrder));
    res.json({ brokers: rows });
  }),
);

/** Showcase strategies for the copy-picker (copying itself is manual). */
brokersRouter.get(
  '/strategies',
  asyncHandler(async (_req, res) => {
    const rows = await db
      .select()
      .from(schema.strategies)
      .where(eq(schema.strategies.isActive, true));
    res.json({ strategies: rows });
  }),
);

/** A member's own linked broker accounts. */
brokersRouter.get(
  '/accounts',
  asyncHandler(async (req, res) => {
    const rows = await db
      .select()
      .from(schema.clientBrokerAccounts)
      .where(eq(schema.clientBrokerAccounts.userId, req.user!.id))
      .orderBy(desc(schema.clientBrokerAccounts.createdAt));
    res.json({ accounts: rows });
  }),
);

const accountSchema = z.object({
  brokerLinkId: z.string().uuid(),
  accountRef: z.string().min(1),
  fundedAmountCents: z.number().int().nonnegative().optional(),
  notes: z.string().optional(),
});

/** Record a broker account the member opened/copies on the broker's own site. */
brokersRouter.post(
  '/accounts',
  asyncHandler(async (req, res) => {
    const body = accountSchema.parse(req.body);
    const [broker] = await db
      .select({ id: schema.brokerLinks.id })
      .from(schema.brokerLinks)
      .where(eq(schema.brokerLinks.id, body.brokerLinkId));
    if (!broker) throw ApiError.badRequest('Broker link not found');

    const [account] = await db
      .insert(schema.clientBrokerAccounts)
      .values({
        userId: req.user!.id,
        brokerLinkId: body.brokerLinkId,
        accountRef: body.accountRef,
        fundedAmountCents: body.fundedAmountCents ?? 0,
        notes: body.notes ?? null,
        status: 'PENDING',
      })
      .returning();
    res.status(201).json({ account });
  }),
);
