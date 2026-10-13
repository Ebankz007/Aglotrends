import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../lib/async.js';
import { requireAuth } from '../lib/auth.js';
import {
  addMemberMessage,
  createTicket,
  getTicketForMember,
  listMyTickets,
} from '../services/support.js';

export const supportRouter = Router();
supportRouter.use(requireAuth);

const createSchema = z.object({
  subject: z.string().trim().min(3).max(200),
  category: z.string().trim().max(40).optional(),
  priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']).optional(),
  message: z.string().trim().min(1).max(5000),
});

const messageSchema = z.object({ body: z.string().trim().min(1).max(5000) });

/** The member's own tickets, newest activity first. */
supportRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json({ tickets: await listMyTickets(req.user!.id) });
  }),
);

/** Open a ticket. The first message is part of the same transaction. */
supportRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const body = createSchema.parse(req.body);
    const ticket = await createTicket(req.user!.id, body);
    res.status(201).json({ ticket });
  }),
);

supportRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    res.json(await getTicketForMember(req.user!.id, req.params.id!));
  }),
);

supportRouter.post(
  '/:id/messages',
  asyncHandler(async (req, res) => {
    const { body } = messageSchema.parse(req.body);
    res.status(201).json(await addMemberMessage(req.user!.id, req.params.id!, body));
  }),
);
