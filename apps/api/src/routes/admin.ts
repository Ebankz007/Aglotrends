import { Router } from 'express';
import { z } from 'zod';
import { desc, eq, sql } from 'drizzle-orm';
import { db, schema } from '../db.js';
import { asyncHandler } from '../lib/async.js';
import { ApiError } from '../lib/errors.js';
import { requireAuth, requireStaff } from '../lib/auth.js';
import { audit } from '../services/audit.js';
import { createSignal, publishSignal } from '../services/signals.js';
import { recordProfitSettlement } from '../services/settlement.js';
import { runRankEvaluation } from '../services/ranks.js';
import { poolBalances } from '../services/pools.js';
import { approvePayout, payPayout, rejectPayout } from '../services/payouts.js';
import { cancelPendingPayment, confirmPaymentManually } from '../services/payment-service.js';

export const adminRouter = Router();
// requireAuth must run first: requireStaff only checks req.user, it does not
// verify the token. Without this, req.user is always undefined and every
// admin request 401s.
adminRouter.use(requireAuth, requireStaff);

/* --------------------------------------------------------------- members */

adminRouter.get(
  '/members',
  asyncHandler(async (_req, res) => {
    const rows = await db
      .select({
        id: schema.users.id,
        email: schema.users.email,
        fullName: schema.users.fullName,
        role: schema.users.role,
        status: schema.users.status,
        sponsorId: schema.users.sponsorId,
        isActiveMember: schema.users.isActiveMember,
        highestAssociateRank: schema.users.highestAssociateRank,
        highestLeadershipRank: schema.users.highestLeadershipRank,
        createdAt: schema.users.createdAt,
      })
      .from(schema.users)
      .orderBy(desc(schema.users.createdAt))
      .limit(500);
    res.json({ members: rows });
  }),
);

const memberPatchSchema = z.object({
  role: z.enum(['MEMBER', 'ADMIN', 'SUPERADMIN']).optional(),
  status: z.enum(['PENDING', 'ACTIVE', 'SUSPENDED']).optional(),
  isActiveMember: z.boolean().optional(),
});

adminRouter.patch(
  '/members/:id',
  asyncHandler(async (req, res) => {
    const body = memberPatchSchema.parse(req.body);
    if (body.role && req.user!.role !== 'SUPERADMIN') {
      throw ApiError.forbidden('Only SUPERADMIN may change roles');
    }
    if (req.params.id! === req.user!.id && (body.role || body.status === 'SUSPENDED')) {
      throw ApiError.forbidden('You cannot change your own role or suspend yourself');
    }

    const [updated] = await db
      .update(schema.users)
      .set({
        ...(body.role ? { role: body.role } : {}),
        ...(body.status ? { status: body.status } : {}),
        ...(body.isActiveMember !== undefined ? { isActiveMember: body.isActiveMember } : {}),
        updatedAt: new Date(),
      })
      .where(eq(schema.users.id, req.params.id!))
      .returning();
    if (!updated) throw ApiError.notFound('Member not found');

    await audit(req.user!.id, 'member.update', 'user', updated.id, body);
    res.json({ member: updated });
  }),
);

/* ----------------------------------------------------------- broker links */

adminRouter.get(
  '/broker-links',
  asyncHandler(async (_req, res) => {
    const rows = await db.select().from(schema.brokerLinks).orderBy(schema.brokerLinks.sortOrder);
    res.json({ brokers: rows });
  }),
);

const brokerLinkSchema = z.object({
  name: z.string().min(1),
  url: z.string().url(),
  description: z.string().optional(),
  logoUrl: z.string().url().optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

adminRouter.post(
  '/broker-links',
  asyncHandler(async (req, res) => {
    const body = brokerLinkSchema.parse(req.body);
    const [row] = await db
      .insert(schema.brokerLinks)
      .values({
        name: body.name,
        url: body.url,
        description: body.description ?? null,
        logoUrl: body.logoUrl ?? null,
        isActive: body.isActive ?? true,
        sortOrder: body.sortOrder ?? 0,
      })
      .returning();
    await audit(req.user!.id, 'broker_link.create', 'broker_link', row?.id, body);
    res.status(201).json({ broker: row });
  }),
);

adminRouter.patch(
  '/broker-links/:id',
  asyncHandler(async (req, res) => {
    const body = brokerLinkSchema.partial().parse(req.body);
    const [row] = await db
      .update(schema.brokerLinks)
      .set({ ...body, updatedAt: new Date() })
      .where(eq(schema.brokerLinks.id, req.params.id!))
      .returning();
    if (!row) throw ApiError.notFound('Broker link not found');
    await audit(req.user!.id, 'broker_link.update', 'broker_link', row.id, body);
    res.json({ broker: row });
  }),
);

adminRouter.delete(
  '/broker-links/:id',
  asyncHandler(async (req, res) => {
    const [row] = await db
      .update(schema.brokerLinks)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(schema.brokerLinks.id, req.params.id!))
      .returning();
    if (!row) throw ApiError.notFound('Broker link not found');
    await audit(req.user!.id, 'broker_link.deactivate', 'broker_link', row.id);
    res.json({ broker: row });
  }),
);

/* ------------------------------------------------------ broker accounts */

adminRouter.get(
  '/broker-accounts',
  asyncHandler(async (_req, res) => {
    const rows = await db
      .select()
      .from(schema.clientBrokerAccounts)
      .orderBy(desc(schema.clientBrokerAccounts.createdAt))
      .limit(500);
    res.json({ accounts: rows });
  }),
);

const verifySchema = z.object({ status: z.enum(['VERIFIED', 'REJECTED']), notes: z.string().optional() });

adminRouter.patch(
  '/broker-accounts/:id',
  asyncHandler(async (req, res) => {
    const body = verifySchema.parse(req.body);
    const [row] = await db
      .update(schema.clientBrokerAccounts)
      .set({
        status: body.status,
        notes: body.notes ?? null,
        verifiedBy: req.user!.id,
        verifiedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(schema.clientBrokerAccounts.id, req.params.id!))
      .returning();
    if (!row) throw ApiError.notFound('Broker account not found');
    await audit(req.user!.id, 'broker_account.verify', 'broker_account', row.id, body);
    res.json({ account: row });
  }),
);

/* --------------------------------------------------------------- signals */

adminRouter.get(
  '/signals',
  asyncHandler(async (_req, res) => {
    const rows = await db.select().from(schema.signals).orderBy(desc(schema.signals.createdAt)).limit(200);
    res.json({ signals: rows });
  }),
);

const signalSchema = z.object({
  title: z.string().min(1),
  instrument: z.string().min(1),
  direction: z.enum(['BUY', 'SELL', 'NEUTRAL']),
  entryPrice: z.string().optional(),
  stopLoss: z.string().optional(),
  takeProfit: z.string().optional(),
  timeframe: z.string().optional(),
  notes: z.string().optional(),
  publish: z.boolean().optional(),
});

adminRouter.post(
  '/signals',
  asyncHandler(async (req, res) => {
    const body = signalSchema.parse(req.body);
    const signal = await createSignal({ authorId: req.user!.id, ...body });
    await audit(req.user!.id, 'signal.create', 'signal', signal.id, { published: !!body.publish });
    res.status(201).json({ signal });
  }),
);

adminRouter.post(
  '/signals/:id/publish',
  asyncHandler(async (req, res) => {
    const signal = await publishSignal(req.params.id!);
    await audit(req.user!.id, 'signal.publish', 'signal', signal.id);
    res.json({ signal });
  }),
);

/* ----------------------------------------------------------- settlements */

adminRouter.get(
  '/settlements',
  asyncHandler(async (_req, res) => {
    const rows = await db
      .select()
      .from(schema.profitSettlements)
      .orderBy(desc(schema.profitSettlements.createdAt))
      .limit(200);
    res.json({ settlements: rows });
  }),
);

const settlementSchema = z.object({
  userId: z.string().uuid(),
  periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  realizedProfitCents: z.number().int(),
});

adminRouter.post(
  '/settlements',
  asyncHandler(async (req, res) => {
    const body = settlementSchema.parse(req.body);
    const settlement = await recordProfitSettlement({ ...body, recordedBy: req.user!.id });
    await audit(req.user!.id, 'settlement.record', 'settlement', settlement.id, body);
    res.status(201).json({ settlement });
  }),
);

/* ---------------------------------------------------------------- ranks */

adminRouter.post(
  '/ranks/evaluate',
  asyncHandler(async (req, res) => {
    const result = await runRankEvaluation();
    await audit(req.user!.id, 'ranks.evaluate', 'system', undefined, result);
    res.json({ result });
  }),
);

adminRouter.get(
  '/rank-awards',
  asyncHandler(async (_req, res) => {
    const rows = await db.select().from(schema.rankAwards).orderBy(desc(schema.rankAwards.createdAt)).limit(200);
    res.json({ awards: rows });
  }),
);

/* ---------------------------------------------------------------- pools */

adminRouter.get(
  '/pools',
  asyncHandler(async (_req, res) => {
    const balances = await poolBalances(db);
    const entries = await db
      .select()
      .from(schema.poolLedger)
      .orderBy(desc(schema.poolLedger.createdAt))
      .limit(100);
    res.json({ balances, entries });
  }),
);

/* ------------------------------------------------------------- payments */

/**
 * Every invoice, newest first, joined to its member, plus the totals an
 * operator reconciles against the gateway — and the chase list of members who
 * registered but never paid the fee. Read-only.
 */
adminRouter.get(
  '/payments',
  asyncHandler(async (_req, res) => {
    const rows = await db
      .select({
        id: schema.payments.id,
        userId: schema.payments.userId,
        userEmail: schema.users.email,
        userFullName: schema.users.fullName,
        purpose: schema.payments.purpose,
        amountCents: schema.payments.amountCents,
        currency: schema.payments.currency,
        status: schema.payments.status,
        paymentRef: schema.payments.paymentRef,
        gatewayTxid: schema.payments.gatewayTxid,
        txHash: schema.payments.txHash,
        paidAt: schema.payments.paidAt,
        createdAt: schema.payments.createdAt,
      })
      .from(schema.payments)
      .innerJoin(schema.users, eq(schema.payments.userId, schema.users.id))
      .orderBy(desc(schema.payments.createdAt))
      .limit(500);

    // Totals over the whole table, not just the visible page.
    const [summary] = await db
      .select({
        registrationCollectedCents: sql<number>`coalesce(sum(${schema.payments.amountCents}) filter (where ${schema.payments.purpose} = 'REGISTRATION' and ${schema.payments.status} = 'PAID'), 0)::int`,
        registrationPaidCount: sql<number>`(count(*) filter (where ${schema.payments.purpose} = 'REGISTRATION' and ${schema.payments.status} = 'PAID'))::int`,
        registrationPendingCount: sql<number>`(count(*) filter (where ${schema.payments.purpose} = 'REGISTRATION' and ${schema.payments.status} = 'PENDING'))::int`,
        depositCollectedCents: sql<number>`coalesce(sum(${schema.payments.amountCents}) filter (where ${schema.payments.purpose} = 'DEPOSIT' and ${schema.payments.status} = 'PAID'), 0)::int`,
        depositPaidCount: sql<number>`(count(*) filter (where ${schema.payments.purpose} = 'DEPOSIT' and ${schema.payments.status} = 'PAID'))::int`,
        depositPendingCount: sql<number>`(count(*) filter (where ${schema.payments.purpose} = 'DEPOSIT' and ${schema.payments.status} = 'PENDING'))::int`,
      })
      .from(schema.payments);

    // Inactive members who never settled the fee. An inactive member WITH a
    // registration row was deactivated by hand — a different problem, and not
    // chased here, so the join disambiguates the two causes.
    const inactive = await db
      .select({
        id: schema.users.id,
        email: schema.users.email,
        fullName: schema.users.fullName,
        createdAt: schema.users.createdAt,
        registrationId: schema.registrations.id,
      })
      .from(schema.users)
      .leftJoin(schema.registrations, eq(schema.registrations.userId, schema.users.id))
      .where(eq(schema.users.isActiveMember, false))
      .orderBy(desc(schema.users.createdAt))
      .limit(500);
    const unpaidMembers = inactive
      .filter((r) => r.registrationId === null)
      .map((r) => ({ id: r.id, email: r.email, fullName: r.fullName, createdAt: r.createdAt }));

    res.json({ payments: rows, summary, unpaidMembers });
  }),
);

/**
 * Manual settlement for off-rail money (cash, a transfer, a webhook the
 * gateway never delivered). Runs the exact webhook confirmation path, so it is
 * idempotent: confirming an already-PAID invoice is a no-op for the ledger.
 */
adminRouter.post(
  '/payments/:id/confirm',
  asyncHandler(async (req, res) => {
    const id = z.string().uuid().parse(req.params.id);
    const body = z.object({ txHash: z.string().min(1).optional() }).parse(req.body ?? {});
    const result = await confirmPaymentManually(id, body.txHash ?? null);
    await audit(req.user!.id, 'payment.confirm', 'payment', id, { applied: result.applied });
    res.json({ result });
  }),
);

/** Expire a stale PENDING invoice so the member can start a fresh one. */
adminRouter.post(
  '/payments/:id/cancel',
  asyncHandler(async (req, res) => {
    const id = z.string().uuid().parse(req.params.id);
    const payment = await cancelPendingPayment(id);
    await audit(req.user!.id, 'payment.cancel', 'payment', id);
    res.json({ payment });
  }),
);

/* -------------------------------------------------------------- payouts */

adminRouter.get(
  '/payouts',
  asyncHandler(async (_req, res) => {
    const rows = await db.select().from(schema.payouts).orderBy(desc(schema.payouts.createdAt)).limit(500);
    res.json({ payouts: rows });
  }),
);

adminRouter.post(
  '/payouts/:id/approve',
  asyncHandler(async (req, res) => {
    const payout = await approvePayout(req.params.id!, req.user!.id);
    await audit(req.user!.id, 'payout.approve', 'payout', req.params.id!);
    res.json({ payout });
  }),
);

adminRouter.post(
  '/payouts/:id/reject',
  asyncHandler(async (req, res) => {
    const payout = await rejectPayout(req.params.id!, req.user!.id);
    await audit(req.user!.id, 'payout.reject', 'payout', req.params.id!);
    res.json({ payout });
  }),
);

adminRouter.post(
  '/payouts/:id/pay',
  asyncHandler(async (req, res) => {
    const payout = await payPayout(req.params.id!, req.user!.id);
    await audit(req.user!.id, 'payout.pay', 'payout', req.params.id!);
    res.json({ payout });
  }),
);

/* ---------------------------------------------------------------- audit */

adminRouter.get(
  '/audit',
  asyncHandler(async (_req, res) => {
    const rows = await db.select().from(schema.auditLog).orderBy(desc(schema.auditLog.createdAt)).limit(300);
    res.json({ entries: rows });
  }),
);
