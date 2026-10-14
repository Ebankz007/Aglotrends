import { Router } from 'express';
import { desc, eq } from 'drizzle-orm';
import { db, schema } from '../db.js';
import { asyncHandler } from '../lib/async.js';
import { ApiError } from '../lib/errors.js';
import { requireActiveMember, requireAuth } from '../lib/auth.js';

export const signalsRouter = Router();
signalsRouter.use(requireAuth, requireActiveMember);

signalsRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const rows = await db
      .select()
      .from(schema.signals)
      .where(eq(schema.signals.status, 'PUBLISHED'))
      .orderBy(desc(schema.signals.publishedAt))
      .limit(100);
    res.json({ signals: rows });
  }),
);

signalsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const [signal] = await db
      .select()
      .from(schema.signals)
      .where(eq(schema.signals.id, req.params.id!));
    if (!signal) throw ApiError.notFound('Signal not found');
    res.json({ signal });
  }),
);
