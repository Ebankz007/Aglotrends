import { Router } from 'express';
import { asyncHandler } from '../lib/async.js';
import { getSiteContent, getSocialSettings } from '../services/settings.js';

export const contentRouter = Router();

/**
 * Public marketing surface for the landing page and footer. Unauthenticated by
 * design — this is copy the whole world reads. It carries two things: the
 * landing-page overrides (`content: null` when the page uses its defaults, so
 * the web app need not ship the copy twice) and the ENABLED social links.
 * Neither is a secret: the settings service stores only operator-authored copy.
 */
contentRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const [content, social] = await Promise.all([getSiteContent(), getSocialSettings()]);
    // Short public cache: content changes rarely, and a stale minute is fine.
    res.set('Cache-Control', 'public, max-age=30');
    res.json({ content, social });
  }),
);
