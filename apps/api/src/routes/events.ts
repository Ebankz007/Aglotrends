import { Router } from 'express';
import { asyncHandler } from '../lib/async.js';
import { requireActiveMember, requireAuth } from '../lib/auth.js';
import {
  cancelRsvp,
  getEvent,
  listPastEvents,
  listUpcomingEvents,
  rsvp,
} from '../services/events.js';

export const eventsRouter = Router();
eventsRouter.use(requireAuth, requireActiveMember);

/** Upcoming and past published events, each with the caller's RSVP state. */
eventsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const [upcoming, past] = await Promise.all([
      listUpcomingEvents(req.user!.id),
      listPastEvents(req.user!.id),
    ]);
    res.json({ upcoming, past });
  }),
);

eventsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    res.json({ event: await getEvent(req.params.id!, req.user!.id) });
  }),
);

eventsRouter.post(
  '/:id/rsvp',
  asyncHandler(async (req, res) => {
    const status = await rsvp(req.user!.id, req.params.id!);
    res.json({ ok: true, status });
  }),
);

eventsRouter.delete(
  '/:id/rsvp',
  asyncHandler(async (req, res) => {
    const status = await cancelRsvp(req.user!.id, req.params.id!);
    res.json({ ok: true, status });
  }),
);
