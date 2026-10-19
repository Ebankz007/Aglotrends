import { Router } from 'express';
import { and, desc, eq, gt, inArray, or } from 'drizzle-orm';
import { db, schema } from '../db.js';
import { asyncHandler } from '../lib/async.js';
import { ApiError } from '../lib/errors.js';
import { requireActiveMember, requireAuth } from '../lib/auth.js';

export const signalsRouter = Router();
signalsRouter.use(requireAuth, requireActiveMember);

signalsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const userId = (req as any).user?.id;
    // Fetch published signals
    const published = await db
      .select()
      .from(schema.signals)
      .where(eq(schema.signals.status, 'PUBLISHED'))
      .orderBy(desc(schema.signals.publishedAt))
      .limit(200);

    if (!userId) {
      // Unauthenticated fallback: only FREE
      const free = published.filter(s => s.visibility === 'FREE');
      return res.json({ signals: free.slice(0, 100) });
    }

    // Determine providers user is subscribed to
    const now = new Date();
    const subs = await db
      .select({ providerId: schema.userSubscriptions.providerId })
      .from(schema.userSubscriptions)
      .where(
        and(
          eq(schema.userSubscriptions.userId, userId),
          eq(schema.userSubscriptions.status, 'ACTIVE'),
          gt(schema.userSubscriptions.expiresAt, now),
        ),
      );

    const allowedProviderIds = new Set(subs.map(s => s.providerId));

    const filtered = published.filter(s => {
      if (s.visibility === 'FREE') return true;
      if (s.visibility === 'PREMIUM' && s.authorId && allowedProviderIds.has(s.authorId)) {
        return true;
      }
      return false;
    });

    // For PREMIUM signals without access, return teaser
    const signals = filtered.map(s => {
      if (s.visibility === 'PREMIUM' && s.authorId && !allowedProviderIds.has(s.authorId)) {
        return {
          id: s.id,
          title: s.title,
          instrument: s.instrument,
          visibility: s.visibility,
          authorId: s.authorId,
          publishedAt: s.publishedAt,
          teaser: true,
        };
      }
      return s;
    });

    res.json({ signals: signals.slice(0, 100) });
  }),
);

signalsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const userId = (req as any).user?.id;
    const [signal] = await db
      .select()
      .from(schema.signals)
      .where(eq(schema.signals.id, req.params.id!));
    if (!signal) throw ApiError.notFound('Signal not found');

    if (signal.visibility === 'PREMIUM' && signal.authorId) {
      if (!userId) {
        return res.json({ signal: { id: signal.id, title: signal.title, instrument: signal.instrument, visibility: 'PREMIUM', teaser: true } });
      }
      const now = new Date();
      const [sub] = await db
        .select()
        .from(schema.userSubscriptions)
        .where(
          and(
            eq(schema.userSubscriptions.userId, userId),
            eq(schema.userSubscriptions.providerId, signal.authorId),
            eq(schema.userSubscriptions.status, 'ACTIVE'),
            gt(schema.userSubscriptions.expiresAt, now),
          ),
        );
      if (!sub) {
        return res.json({ signal: { id: signal.id, title: signal.title, instrument: signal.instrument, visibility: 'PREMIUM', teaser: true } });
      }
    }

    res.json({ signal });
  }),
);
