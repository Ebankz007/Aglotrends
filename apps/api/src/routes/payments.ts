import { Router } from 'express';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '../db.js';
import { asyncHandler } from '../lib/async.js';
import { requireAuth } from '../lib/auth.js';
import {
  ALLOWED_NETWORKS,
  createPayment,
  listMyPayments,
  refreshCheckoutUrl,
  type PaymentPurpose,
} from '../services/payment-service.js';
import { gatewayIsMock } from '../services/settings.js';

export const paymentsRouter = Router();
paymentsRouter.use(requireAuth);

const networkSchema = z.enum(ALLOWED_NETWORKS);

const depositSchema = z.object({
  amountCents: z.number().int().positive().max(100_000_000),
  network: networkSchema.optional(),
});

const registrationSchema = z.object({
  network: networkSchema.optional(),
});

/** One PENDING invoice per purpose per member — no invoice spam, ever. */
async function hasPendingInvoice(userId: string, purpose: PaymentPurpose): Promise<boolean> {
  const [existing] = await db
    .select({ id: schema.payments.id })
    .from(schema.payments)
    .where(
      and(
        eq(schema.payments.userId, userId),
        eq(schema.payments.purpose, purpose),
        eq(schema.payments.status, 'PENDING'),
      ),
    )
    .limit(1);
  return !!existing;
}

/** The §1 fee is paid once. The `registrations` row is the receipt. */
async function alreadyRegistered(userId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: schema.registrations.id })
    .from(schema.registrations)
    .where(eq(schema.registrations.userId, userId))
    .limit(1);
  return !!row;
}

/**
 * Create the $20 REGISTRATION invoice (§1 membership fee). One pending invoice
 * at a time. When the webhook confirms it, compensation is distributed and the
 * member is activated.
 */
paymentsRouter.post(
  '/registration',
  asyncHandler(async (req, res) => {
    if (await alreadyRegistered(req.user!.id)) {
      res.status(409).json({
        error: 'Registration fee already paid',
        code: 'ALREADY_REGISTERED',
      });
      return;
    }
    if (await hasPendingInvoice(req.user!.id, 'REGISTRATION')) {
      res.status(409).json({
        error: 'You already have a pending registration payment',
        code: 'PENDING_PAYMENT_EXISTS',
      });
      return;
    }
    const { network } = registrationSchema.parse(req.body ?? {});
    const payment = await createPayment(req.user!.id, 'REGISTRATION', undefined, network);
    res.status(201).json({ payment, mock: gatewayIsMock() });
    return;
  }),
);

/** Create a DEPOSIT invoice → credits the wallet on confirmation. */
paymentsRouter.post(
  '/deposit',
  asyncHandler(async (req, res) => {
    const { amountCents, network } = depositSchema.parse(req.body);
    const payment = await createPayment(req.user!.id, 'DEPOSIT', amountCents, network);
    res.status(201).json({ payment, mock: gatewayIsMock() });
    return;
  }),
);

/** The member's payment history. */
paymentsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json({ payments: await listMyPayments(req.user!.id) });
  }),
);

/**
 * Fresh checkout URL for a PENDING payment. Returns the stored URL while it is
 * younger than the gateway expiry margin, otherwise issues a new gateway
 * request against the same row. The checkout button calls this first so the
 * member never lands on a dead (1-hour-expired) link.
 */
paymentsRouter.post(
  '/:id/checkout',
  asyncHandler(async (req, res) => {
    const id = z.string().uuid().parse(req.params.id);
    res.json({ ...(await refreshCheckoutUrl(req.user!.id, id)), mock: gatewayIsMock() });
    return;
  }),
);
