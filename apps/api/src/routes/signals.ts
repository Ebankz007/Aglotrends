import { Router } from 'express';
import { and, desc, eq, gt, inArray, or } from 'drizzle-orm';
import { db, schema } from '../db.js';
import { asyncHandler } from '../lib/async.js';
import { ApiError } from '../lib/errors.js';
import { requireActiveMember, requireAuth } from '../lib/auth.js';

export const signalsRouter = Router();
signalsRouter.use(requireAuth, requireActiveMember);

const GRACE_MS = 7 * 24 * 60 * 60 * 1000;

async function getProviderAccess(userId: string, providerId: string) {
  const now = new Date();
  const subs = await db
    .select()
    .from(schema.userSubscriptions)
    .where(
      and(
        eq(schema.userSubscriptions.userId, userId),
        eq(schema.userSubscriptions.providerId, providerId),
        eq(schema.userSubscriptions.status, 'ACTIVE'),
      ),
    )
    .orderBy(desc(schema.userSubscriptions.expiresAt));
  if (subs.length === 0) return { hasAccess: false, inGrace: false, expiresAt: null };
  const latest = subs[0];
  if (!latest) return { hasAccess: false, inGrace: false, expiresAt: null };
  const expiresAt = new Date(latest.expiresAt);
  if (expiresAt > now) return { hasAccess: true, inGrace: false, expiresAt };
  const graceUntil = new Date(expiresAt.getTime() + GRACE_MS);
  if (graceUntil >= now) return { hasAccess: false, inGrace: true, expiresAt };
  return { hasAccess: false, inGrace: false, expiresAt };
}

signalsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const userId = (req as any).user?.id;
    const published = await db
      .select()
      .from(schema.signals)
      .where(eq(schema.signals.status, 'PUBLISHED'))
      .orderBy(desc(schema.signals.publishedAt))
      .limit(200);

    if (!userId) {
      const free = published.filter(s => s.visibility === 'FREE');
      return res.json({ signals: free.slice(0, 100) });
    }

    const now = new Date();
    const signals = await Promise.all(
      published.map(async (s) => {
        if (s.visibility === 'FREE') return s;
        if (!s.authorId) return { ...s, teaser: true };
        const access = await getProviderAccess(userId, s.authorId);
        if (access.hasAccess) return { ...s, grace: false };
        if (access.inGrace) {
          const publishedAt = s.publishedAt ? new Date(s.publishedAt) : null;
          const expiresAt = access.expiresAt ? new Date(access.expiresAt) : null;
          if (publishedAt && expiresAt && publishedAt <= expiresAt) {
            return { ...s, grace: true };
          }
        }
        // teaser
        return {
          id: s.id,
          title: s.title,
          instrument: s.instrument,
          visibility: s.visibility,
          authorId: s.authorId,
          publishedAt: s.publishedAt,
          teaser: true,
        };
      })
    );

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
      const access = await getProviderAccess(userId, signal.authorId);
      if (access.hasAccess) {
        return res.json({ signal: { ...signal, grace: false } });
      }
      if (access.inGrace) {
        const publishedAt = signal.publishedAt ? new Date(signal.publishedAt) : null;
        const expiresAt = access.expiresAt ? new Date(access.expiresAt) : null;
        if (publishedAt && expiresAt && publishedAt <= expiresAt) {
          return res.json({ signal: { ...signal, grace: true } });
        }
      }
      return res.json({ signal: { id: signal.id, title: signal.title, instrument: signal.instrument, visibility: 'PREMIUM', teaser: true } });
    }

    res.json({ signal });
  }),
);
