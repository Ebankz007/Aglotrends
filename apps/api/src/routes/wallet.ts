import { Router } from 'express';
import { z } from 'zod';
import { desc, eq } from 'drizzle-orm';
import { db, schema } from '../db.js';
import { asyncHandler } from '../lib/async.js';
import { ApiError } from '../lib/errors.js';
import { requireAuth } from '../lib/auth.js';
import { requestPayout } from '../services/payouts.js';

export const walletRouter = Router();
walletRouter.use(requireAuth);

walletRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const [wallet] = await db
      .select()
      .from(schema.wallets)
      .where(eq(schema.wallets.userId, req.user!.id));
    if (!wallet) throw ApiError.notFound('Wallet not found');
    res.json({ balanceCents: wallet.balanceCents });
  }),
);

walletRouter.get(
  '/ledger',
  asyncHandler(async (req, res) => {
    const rows = await db
      .select()
      .from(schema.ledgerEntries)
      .where(eq(schema.ledgerEntries.userId, req.user!.id))
      .orderBy(desc(schema.ledgerEntries.createdAt))
      .limit(200);
    res.json({ entries: rows });
  }),
);

walletRouter.get(
  '/payouts',
  asyncHandler(async (req, res) => {
    const rows = await db
      .select()
      .from(schema.payouts)
      .where(eq(schema.payouts.userId, req.user!.id))
      .orderBy(desc(schema.payouts.createdAt));
    res.json({ payouts: rows });
  }),
);

const payoutSchema = z.object({
  amountCents: z.number().int().positive(),
  method: z.string().optional(),
  details: z.string().optional(),
});

walletRouter.post(
  '/payouts',
  asyncHandler(async (req, res) => {
    const body = payoutSchema.parse(req.body);
    const payout = await requestPayout({ userId: req.user!.id, ...body });
    res.status(201).json({ payout });
  }),
);
