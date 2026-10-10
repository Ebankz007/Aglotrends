import { Router } from 'express';
import { asyncHandler } from '../lib/async.js';
import { getSiteContent } from '../services/settings.js';

export const contentRouter = Router();

/**
 * Public marketing-content overrides for the landing page. Unauthenticated by
 * design — this is copy the whole world reads. It carries no secrets: the
 * settings service only ever stores operator-authored strings here.
 *
 * Returns `{ content: null }` when nothing has been customised, so the web app
 * can fall back to its own built-in defaults rather than shipping copy twice.
 */
contentRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const content = await getSiteContent();
    // Short public cache: content changes rarely, and a stale minute is fine.
    res.set('Cache-Control', 'public, max-age=30');
    res.json({ content });
  }),
);
