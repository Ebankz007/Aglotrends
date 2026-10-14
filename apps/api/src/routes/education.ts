import { Router } from 'express';
import { asyncHandler } from '../lib/async.js';
import { requireActiveMember, requireAuth } from '../lib/auth.js';
import { getPublishedResource, listPublishedResources } from '../services/education.js';

export const educationRouter = Router();
educationRouter.use(requireAuth, requireActiveMember);

/** The member learning library — published resources only. */
educationRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    res.json({ resources: await listPublishedResources() });
  }),
);

educationRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    res.json({ resource: await getPublishedResource(req.params.id!) });
  }),
);
