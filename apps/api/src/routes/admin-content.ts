import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../lib/async.js';
import { requireAuth, requireStaff } from '../lib/auth.js';
import { requireAreaAccess } from '../lib/admin-access.js';
import { audit } from '../services/audit.js';
import {
  createResource,
  deleteResource,
  listAllResources,
  updateResource,
} from '../services/education.js';
import {
  createEvent,
  deleteEvent,
  listAllEvents,
  listEventRegistrations,
  updateEvent,
} from '../services/events.js';
import {
  addStaffMessage,
  getTicketForStaff,
  listAllTickets,
  setTicketStatus,
} from '../services/support.js';

/**
 * Admin surface for the member-engagement domains: Education, Events, Support.
 * Mounted at `/api/admin` alongside the main admin router. Guards are applied
 * here too so the router is safe regardless of mount order.
 */
export const adminContentRouter = Router();
adminContentRouter.use(requireAuth, requireStaff, requireAreaAccess);

/* ------------------------------------------------------------- education */

adminContentRouter.get(
  '/education',
  asyncHandler(async (_req, res) => {
    res.json({ resources: await listAllResources() });
  }),
);

const resourceSchema = z.object({
  title: z.string().trim().min(1).max(200),
  summary: z.string().trim().max(500).nullish(),
  body: z.string().max(20000).nullish(),
  category: z.string().trim().max(40).optional(),
  level: z.string().trim().max(40).nullish(),
  resourceType: z.enum(['ARTICLE', 'VIDEO', 'LINK']).optional(),
  url: z.string().trim().url().max(2000).nullish(),
  coverImageUrl: z.string().trim().url().max(2000).nullish(),
  isPublished: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

adminContentRouter.post(
  '/education',
  asyncHandler(async (req, res) => {
    const body = resourceSchema.parse(req.body);
    const resource = await createResource(body);
    await audit(req.user!.id, 'education.create', 'education_resource', resource.id, {
      title: resource.title,
    });
    res.status(201).json({ resource });
  }),
);

adminContentRouter.patch(
  '/education/:id',
  asyncHandler(async (req, res) => {
    const body = resourceSchema.partial().parse(req.body);
    const resource = await updateResource(req.params.id!, body);
    await audit(req.user!.id, 'education.update', 'education_resource', resource.id, body);
    res.json({ resource });
  }),
);

adminContentRouter.delete(
  '/education/:id',
  asyncHandler(async (req, res) => {
    const resource = await deleteResource(req.params.id!);
    await audit(req.user!.id, 'education.delete', 'education_resource', resource.id, {
      title: resource.title,
    });
    res.json({ resource });
  }),
);

/* ---------------------------------------------------------------- events */

adminContentRouter.get(
  '/events',
  asyncHandler(async (_req, res) => {
    res.json({ events: await listAllEvents() });
  }),
);

const eventSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().max(20000).nullish(),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date().nullish(),
  location: z.string().trim().max(200).nullish(),
  url: z.string().trim().url().max(2000).nullish(),
  coverImageUrl: z.string().trim().url().max(2000).nullish(),
  isPublished: z.boolean().optional(),
});

adminContentRouter.post(
  '/events',
  asyncHandler(async (req, res) => {
    const body = eventSchema.parse(req.body);
    const event = await createEvent(body);
    await audit(req.user!.id, 'event.create', 'event', event.id, { title: event.title });
    res.status(201).json({ event });
  }),
);

adminContentRouter.patch(
  '/events/:id',
  asyncHandler(async (req, res) => {
    const body = eventSchema.partial().parse(req.body);
    const event = await updateEvent(req.params.id!, body);
    await audit(req.user!.id, 'event.update', 'event', event.id, body);
    res.json({ event });
  }),
);

adminContentRouter.delete(
  '/events/:id',
  asyncHandler(async (req, res) => {
    const event = await deleteEvent(req.params.id!);
    await audit(req.user!.id, 'event.delete', 'event', event.id, { title: event.title });
    res.json({ event });
  }),
);

adminContentRouter.get(
  '/events/:id/registrations',
  asyncHandler(async (req, res) => {
    res.json({ registrations: await listEventRegistrations(req.params.id!) });
  }),
);

/* --------------------------------------------------------------- support */

adminContentRouter.get(
  '/support',
  asyncHandler(async (req, res) => {
    const status = z
      .enum(['OPEN', 'PENDING', 'RESOLVED', 'CLOSED'])
      .optional()
      .parse(typeof req.query.status === 'string' ? req.query.status : undefined);
    res.json({ tickets: await listAllTickets({ status }) });
  }),
);

adminContentRouter.get(
  '/support/:id',
  asyncHandler(async (req, res) => {
    res.json(await getTicketForStaff(req.params.id!));
  }),
);

adminContentRouter.post(
  '/support/:id/messages',
  asyncHandler(async (req, res) => {
    const { body } = z.object({ body: z.string().trim().min(1).max(5000) }).parse(req.body);
    const thread = await addStaffMessage(req.user!.id, req.params.id!, body);
    await audit(req.user!.id, 'support.reply', 'support_ticket', req.params.id!);
    res.status(201).json(thread);
  }),
);

adminContentRouter.patch(
  '/support/:id',
  asyncHandler(async (req, res) => {
    const { status } = z
      .object({ status: z.enum(['OPEN', 'PENDING', 'RESOLVED', 'CLOSED']) })
      .parse(req.body);
    const ticket = await setTicketStatus(req.params.id!, status);
    await audit(req.user!.id, 'support.status', 'support_ticket', ticket.id, { status });
    res.json({ ticket });
  }),
);
