import { Router } from 'express';
import { z } from 'zod';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { db, schema } from '../db.js';
import { asyncHandler } from '../lib/async.js';
import { ApiError } from '../lib/errors.js';
import { hashPassword, requireAuth, requireStaff, requireSuperAdmin } from '../lib/auth.js';
import { requireAreaAccess } from '../lib/admin-access.js';
import {
  ADMIN_AREAS,
  PERMISSION_LEVELS,
  describePermissions,
  normalizePermissionMap,
} from '../lib/permissions.js';
import { audit } from '../services/audit.js';
import { createSignal, publishSignal } from '../services/signals.js';
import { recordProfitSettlement } from '../services/settlement.js';
import { runRankEvaluation } from '../services/ranks.js';
import { BROADCAST_AUDIENCES, dispatchBroadcast } from '../notifications/index.js';
import { emailConfigured, sendEmail } from '../notifications/email.js';
import {
  gatewaySettingsView,
  getPlatformSettings,
  getSiteContent,
  getSocialSettingsAdmin,
  integrationsView,
  platformFeeSettingsView,
  resolveEmailIntegration,
  saveGatewaySettings,
  saveIntegrations,
  savePlatformFeeSettings,
  savePlatformSettings,
  saveSiteContent,
  saveSocialSettings,
} from '../services/settings.js';
import { poolBalances } from '../services/pools.js';
import { approvePayout, payPayout, rejectPayout } from '../services/payouts.js';
import { cancelPendingPayment, confirmPaymentManually } from '../services/payment-service.js';
import {
  listPlatformFees,
  platformFeeSummary,
  settleAllPendingFees,
  settlePlatformFees,
} from '../services/platform-fees.js';
import { listKycSubmissions, reviewKyc } from '../services/kyc.js';

export const adminRouter = Router();
// requireAuth must run first: requireStaff only checks req.user, it does not
// verify the token. Without this, req.user is always undefined and every
// admin request 401s.
//
// requireAreaAccess then maps the path to an admin area and enforces the
// caller's grant (GET -> VIEW, mutations -> MANAGE). It fails closed, so a
// route with no entry in the policy table is denied rather than exposed.
adminRouter.use(requireAuth, requireStaff, requireAreaAccess);

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
        referralCode: schema.users.referralCode,
        isActiveMember: schema.users.isActiveMember,
        highestAssociateRank: schema.users.highestAssociateRank,
        highestLeadershipRank: schema.users.highestLeadershipRank,
        createdAt: schema.users.createdAt,
      })
      .from(schema.users)
      .orderBy(desc(schema.users.createdAt))
      .limit(500);
    const sponsorIds = [...new Set(rows.map((r) => r.sponsorId).filter((s): s is string => !!s))];
    const sponsors =
      sponsorIds.length > 0
        ? await db
            .select({
              id: schema.users.id,
              email: schema.users.email,
              referralCode: schema.users.referralCode,
            })
            .from(schema.users)
            .where(inArray(schema.users.id, sponsorIds))
        : [];
    const sponsorEmailById = new Map(sponsors.map((s) => [s.id, s.email]));
    const sponsorCodeById = new Map(sponsors.map((s) => [s.id, s.referralCode]));
    res.json({
      members: rows.map((r) => ({
        ...r,
        sponsorEmail: r.sponsorId ? (sponsorEmailById.get(r.sponsorId) ?? null) : null,
        sponsorCode: r.sponsorId ? (sponsorCodeById.get(r.sponsorId) ?? null) : null,
      })),
    });
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

    const [target] = await db
      .select({ role: schema.users.role, status: schema.users.status })
      .from(schema.users)
      .where(eq(schema.users.id, req.params.id!))
      .limit(1);
    if (!target) throw ApiError.notFound('Member not found');

    // Never let the platform be locked out of its own superadmin seat: refuse
    // to demote or suspend the last remaining active SUPERADMIN.
    const demote = body.role !== undefined && body.role !== 'SUPERADMIN';
    const suspend = body.status === 'SUSPENDED';
    if (target.role === 'SUPERADMIN' && target.status === 'ACTIVE' && (demote || suspend)) {
      const [counts] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(schema.users)
        .where(and(eq(schema.users.role, 'SUPERADMIN'), eq(schema.users.status, 'ACTIVE')));
      if ((counts?.n ?? 0) <= 1) {
        throw ApiError.conflict(
          'Cannot demote or suspend the last active SUPERADMIN',
          'LAST_SUPERADMIN',
        );
      }
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

const sponsorReassignSchema = z.object({
  sponsorCode: z.string().trim().min(4).max(16),
});

/**
 * Move a member under a new sponsor, by request ("place a member under
 * another member"). Money semantics, read carefully:
 *
 * - Past payouts STAND. The `registrations` row snapshotted the old sponsor
 *   and bonuses already paid are never re-run.
 * - Future upline attribution (generation, rank volume, sponsor overrides)
 *   follows the NEW chain from this moment on.
 * - The matrix seat does NOT move — in a forced matrix with spillover the
 *   sponsor and the matrix parent are routinely different people, so a moved
 *   member is structurally ordinary.
 * - Inactive members are the clean case: placement and bonuses simply follow
 *   the new sponsor when the fee settles.
 *
 * Guards: member accounts only, sponsor must be a member account, no
 * self-sponsorship, and no cycles (a member can never land under their own
 * downline). Everything is audited.
 */
adminRouter.patch(
  '/members/:id/sponsor',
  asyncHandler(async (req, res) => {
    const body = sponsorReassignSchema.parse(req.body);
    const targetId = req.params.id!;

    const [target] = await db
      .select({
        id: schema.users.id,
        email: schema.users.email,
        role: schema.users.role,
        sponsorId: schema.users.sponsorId,
        isActiveMember: schema.users.isActiveMember,
      })
      .from(schema.users)
      .where(eq(schema.users.id, targetId))
      .limit(1);
    if (!target) throw ApiError.notFound('Member not found');
    if (target.role !== 'MEMBER') {
      throw ApiError.badRequest(
        'Only member accounts can be moved under a new sponsor',
        'INVALID_INPUT',
      );
    }

    const [sponsor] = await db
      .select({ id: schema.users.id, role: schema.users.role, referralCode: schema.users.referralCode })
      .from(schema.users)
      .where(eq(schema.users.referralCode, body.sponsorCode.trim().toUpperCase()))
      .limit(1);
    if (!sponsor) {
      throw ApiError.badRequest(
        'New sponsor not found — use the referral code of an existing member',
        'SPONSOR_NOT_FOUND',
      );
    }
    if (sponsor.id === targetId) {
      throw ApiError.badRequest('A member cannot sponsor themselves', 'INVALID_INPUT');
    }
    if (sponsor.role !== 'MEMBER') {
      throw ApiError.badRequest('The new sponsor must be a member account', 'INVALID_INPUT');
    }
    if (target.sponsorId === sponsor.id) {
      throw ApiError.badRequest('Member is already under this sponsor', 'INVALID_INPUT');
    }

    // Cycle guard: walk the candidate sponsor's upline — the target must never
    // appear above them, or the tree would loop and generation walks would spin.
    const seen = new Set<string>();
    let cursor: string | null = sponsor.id;
    while (cursor) {
      if (cursor === targetId) {
        throw ApiError.badRequest(
          'Cannot move a member under their own downline — that would loop the referral tree',
          'SPONSOR_CYCLE',
        );
      }
      if (seen.has(cursor)) break;
      seen.add(cursor);
      const [row] = await db
        .select({ sponsorId: schema.users.sponsorId })
        .from(schema.users)
        .where(eq(schema.users.id, cursor))
        .limit(1);
      cursor = row?.sponsorId ?? null;
    }

    const [updated] = await db
      .update(schema.users)
      .set({ sponsorId: sponsor.id, updatedAt: new Date() })
      .where(eq(schema.users.id, targetId))
      .returning({ id: schema.users.id, email: schema.users.email, sponsorId: schema.users.sponsorId });
    if (!updated) throw ApiError.notFound('Member not found');

    await audit(req.user!.id, 'member.sponsor_reassigned', 'user', targetId, {
      from: target.sponsorId,
      to: sponsor.id,
      wasActiveMember: target.isActiveMember,
    });
    res.json({
      member: updated,
      note: 'Past payouts stand; future upline attribution follows the new sponsor; matrix seat unchanged.',
    });
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
  visibility: z.enum(['FREE', 'PREMIUM']).optional(),
  chartImageUrl: z.string().optional(),
  chartLink: z.string().optional(),
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

adminRouter.patch(
  '/signals/:id',
  asyncHandler(async (req, res) => {
    const body = signalSchema.partial().parse(req.body);
    const signal = await updateSignal(req.params.id!, body);
    await audit(req.user!.id, 'signal.update', 'signal', signal.id);
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

/* ----------------------------------------------------------------- staff */

/** Columns safe to return for a staff account — never the password hash. */
const staffColumns = {
  id: schema.users.id,
  email: schema.users.email,
  fullName: schema.users.fullName,
  role: schema.users.role,
  status: schema.users.status,
  permissions: schema.users.permissions,
  viewOnly: schema.users.viewOnly,
  twoFactorEnabled: schema.users.twoFactorEnabled,
  twoFactorEnrolledAt: schema.users.twoFactorEnrolledAt,
  createdAt: schema.users.createdAt,
  lastLoginAt: schema.users.lastLoginAt,
};

type StaffRow = {
  permissions: Record<string, string> | null;
  [key: string]: unknown;
};

/** Normalises the stored permission map so the console always sees a clean shape. */
function staffView<T extends StaffRow>(row: T) {
  return { ...row, permissions: normalizePermissionMap(row.permissions) };
}

/**
 * The area catalog, so the console renders the permission matrix from the
 * server's definition rather than a hard-coded copy that can drift.
 */
adminRouter.get(
  '/permissions/catalog',
  asyncHandler(async (_req, res) => {
    res.json({ areas: ADMIN_AREAS, levels: PERMISSION_LEVELS });
  }),
);

adminRouter.get(
  '/staff',
  asyncHandler(async (_req, res) => {
    const rows = await db
      .select(staffColumns)
      .from(schema.users)
      .where(inArray(schema.users.role, ['ADMIN', 'SUPERADMIN']))
      .orderBy(desc(schema.users.createdAt));
    res.json({ staff: rows.map(staffView) });
  }),
);

const createStaffSchema = z.object({
  email: z.string().email(),
  fullName: z.string().min(1).max(120),
  password: z.string().min(8).max(200),
  role: z.enum(['ADMIN', 'SUPERADMIN']),
});

/**
 * Provision a staff account. SUPERADMIN-only: an ADMIN cannot mint peers or
 * escalate anyone. Staff are `isActiveMember: true` on purpose — they are not
 * in the compensation network, and marking them inactive would surface them in
 * the "registered, never paid" chase list on the payments tab.
 */
adminRouter.post(
  '/staff',
  requireSuperAdmin,
  asyncHandler(async (req, res) => {
    const body = createStaffSchema.parse(req.body);
    const email = body.email.trim().toLowerCase();

    const [existing] = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.email, email))
      .limit(1);
    if (existing) throw ApiError.conflict('An account with that email already exists', 'EMAIL_TAKEN');

    const [created] = await db
      .insert(schema.users)
      .values({
        email,
        fullName: body.fullName.trim(),
        passwordHash: hashPassword(body.password),
        role: body.role,
        status: 'ACTIVE',
        isActiveMember: true,
      })
      .returning(staffColumns);
    if (!created) throw new Error('staff create failed');

    await audit(req.user!.id, 'staff.create', 'user', created.id, { email, role: body.role });
    res.status(201).json({ staff: staffView(created) });
  }),
);

const updateStaffSchema = z.object({
  role: z.enum(['ADMIN', 'SUPERADMIN']).optional(),
  viewOnly: z.boolean().optional(),
  permissions: z.record(z.enum(['NONE', 'VIEW', 'MANAGE'])).optional(),
});

/**
 * Set a staff member's role, area grants, and view-only cap. SUPERADMIN-only.
 *
 * Two guards protect the platform from locking itself out, mirroring the ones
 * on member updates: a superadmin cannot demote themselves, and the last
 * remaining active superadmin cannot be demoted by anyone.
 */
adminRouter.patch(
  '/staff/:id',
  requireSuperAdmin,
  asyncHandler(async (req, res) => {
    const body = updateStaffSchema.parse(req.body);
    const targetId = req.params.id!;

    const [target] = await db
      .select({ id: schema.users.id, role: schema.users.role, status: schema.users.status })
      .from(schema.users)
      .where(eq(schema.users.id, targetId))
      .limit(1);
    if (!target) throw ApiError.notFound('Staff account not found');
    if (target.role === 'MEMBER') {
      throw ApiError.badRequest('That account is not a staff member', 'NOT_STAFF');
    }

    const demoting = body.role !== undefined && body.role !== 'SUPERADMIN';
    if (demoting && targetId === req.user!.id) {
      throw ApiError.forbidden('You cannot change your own role');
    }
    if (demoting && target.role === 'SUPERADMIN' && target.status === 'ACTIVE') {
      const [counts] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(schema.users)
        .where(and(eq(schema.users.role, 'SUPERADMIN'), eq(schema.users.status, 'ACTIVE')));
      if ((counts?.n ?? 0) <= 1) {
        throw ApiError.conflict(
          'Cannot demote the last active SUPERADMIN',
          'LAST_SUPERADMIN',
        );
      }
    }

    const permissions = body.permissions ? normalizePermissionMap(body.permissions) : undefined;

    const [updated] = await db
      .update(schema.users)
      .set({
        ...(body.role ? { role: body.role } : {}),
        ...(body.viewOnly !== undefined ? { viewOnly: body.viewOnly } : {}),
        ...(permissions ? { permissions } : {}),
        updatedAt: new Date(),
      })
      .where(eq(schema.users.id, targetId))
      .returning(staffColumns);
    if (!updated) throw ApiError.notFound('Staff account not found');

    await audit(req.user!.id, 'staff.update', 'user', targetId, {
      role: body.role,
      viewOnly: body.viewOnly,
      permissions: permissions ? describePermissions(permissions) : undefined,
    });

    res.json({ staff: staffView(updated) });
  }),
);

/* -------------------------------------------------------------- settings */

/**
 * Everything the console needs to configure the platform in one read: the
 * payment gateway (secrets reduced to booleans), the platform switches, and the
 * stored site-content overrides (null when the landing page uses its defaults).
 */
adminRouter.get(
  '/settings',
  requireSuperAdmin,
  asyncHandler(async (_req, res) => {
    res.json({
      gateway: await gatewaySettingsView(),
      platform: await getPlatformSettings(),
      fees: await platformFeeSettingsView(),
      content: await getSiteContent(),
    });
  }),
);

const gatewaySettingsSchema = z.object({
  provider: z.string().min(1).max(40).optional(),
  apiUrl: z.string().max(300).optional(),
  walletAddress: z.string().max(200).optional(),
  network: z.string().min(1).max(40).optional(),
  asset: z.string().min(1).max(20).optional(),
  forceMock: z.boolean().optional(),
  // null clears the stored override (env fallback takes over); undefined leaves it.
  token: z.string().max(500).nullable().optional(),
  webhookSecret: z.string().max(500).nullable().optional(),
});

adminRouter.put(
  '/settings/gateway',
  requireSuperAdmin,
  asyncHandler(async (req, res) => {
    const body = gatewaySettingsSchema.parse(req.body);
    const gateway = await saveGatewaySettings(body);
    // Record WHICH fields changed — never the secret values themselves.
    await audit(req.user!.id, 'settings.gateway.update', 'system', undefined, {
      fields: Object.keys(body),
      mockActive: gateway.mockActive,
    });
    res.json({ gateway });
  }),
);

const platformSettingsSchema = z.object({
  name: z.string().min(1).max(60).optional(),
  registrationOpen: z.boolean().optional(),
});

adminRouter.put(
  '/settings/platform',
  requireSuperAdmin,
  asyncHandler(async (req, res) => {
    const body = platformSettingsSchema.parse(req.body);
    const platform = await savePlatformSettings(body);
    await audit(req.user!.id, 'settings.platform.update', 'system', undefined, body);
    res.json({ platform });
  }),
);

const platformFeeSettingsSchema = z.object({
  walletAddress: z.string().max(200).optional(),
  network: z.string().min(1).max(40).optional(),
  asset: z.string().min(1).max(20).optional(),
  amountCents: z.number().int().min(0).max(1_000_000).optional(),
  enabled: z.boolean().optional(),
});

/**
 * The operator's transaction-fee wallet. SUPERADMIN-only — this address
 * receives platform revenue, and it is deliberately DISTINCT from the gateway's
 * member-facing receiving wallet so the two money flows never share an address.
 */
adminRouter.put(
  '/settings/fees',
  requireSuperAdmin,
  asyncHandler(async (req, res) => {
    const body = platformFeeSettingsSchema.parse(req.body);
    const fees = await savePlatformFeeSettings(body);
    await audit(req.user!.id, 'settings.fees.update', 'system', undefined, {
      fields: Object.keys(body),
      walletConfigured: fees.walletConfigured,
    });
    res.json({ fees });
  }),
);

/* ---------------------------------------------------------- integrations */

/**
 * Every outbound API credential in one place: SMTP email, WhatsApp Cloud API,
 * and the Telegram bot. SUPERADMIN-only — these are the keys that let the
 * platform speak as itself to the whole member base.
 *
 * Secrets are write-only. The read returns `hasToken` and where the value came
 * from, never the value, so the console can confirm a key is set without ever
 * being able to leak it.
 */
adminRouter.get(
  '/integrations',
  requireSuperAdmin,
  asyncHandler(async (_req, res) => {
    res.json({
      integrations: await integrationsView(),
      gateway: await gatewaySettingsView(),
    });
  }),
);

const integrationsSchema = z.object({
  email: z
    .object({
      provider: z.enum(['smtp', 'resend']).optional(),
      enabled: z.boolean().optional(),
      from: z.string().trim().max(200).optional(),
      replyTo: z.string().trim().max(200).optional(),
      // null clears the stored override (env fallback takes over); undefined leaves it.
      smtpUrl: z.string().trim().max(1000).nullable().optional(),
      resendApiKey: z.string().trim().max(500).nullable().optional(),
    })
    .optional(),
  whatsapp: z
    .object({
      enabled: z.boolean().optional(),
      phoneId: z.string().trim().max(60).optional(),
      token: z.string().trim().max(1000).nullable().optional(),
    })
    .optional(),
  telegram: z
    .object({
      enabled: z.boolean().optional(),
      botToken: z.string().trim().max(500).nullable().optional(),
    })
    .optional(),
});

adminRouter.put(
  '/integrations',
  requireSuperAdmin,
  asyncHandler(async (req, res) => {
    const body = integrationsSchema.parse(req.body);
    const integrations = await saveIntegrations(body);
    // Record WHICH channels changed — never a secret value.
    await audit(req.user!.id, 'settings.integrations.update', 'system', undefined, {
      channels: Object.keys(body),
    });
    res.json({ integrations });
  }),
);

/**
 * Send a test email to the caller. The console can confirm a key is SET but
 * never that it WORKS — this closes that gap by exercising the real provider
 * (SMTP or Resend) end to end. SUPERADMIN-only, and it only ever mails the
 * caller, so it cannot be turned into a spam cannon against members.
 */
adminRouter.post(
  '/integrations/email/test',
  requireSuperAdmin,
  asyncHandler(async (req, res) => {
    const cfg = await resolveEmailIntegration();
    if (!emailConfigured(cfg)) {
      throw ApiError.badRequest(
        cfg.provider === 'resend'
          ? 'No Resend API key is set — save one first.'
          : 'No SMTP URL is set — save one first.',
        'EMAIL_NOT_CONFIGURED',
      );
    }
    const [me] = await db
      .select({ email: schema.users.email })
      .from(schema.users)
      .where(eq(schema.users.id, req.user!.id))
      .limit(1);
    if (!me?.email) {
      throw ApiError.badRequest('Your account has no email address to send to.', 'NO_EMAIL');
    }
    await sendEmail(
      me.email,
      'Aglotrends test email',
      'This is a test email from the Aglotrends console. If you are reading it, outbound email is working.',
      '<p>This is a test email from the Aglotrends console. If you are reading it, <strong>outbound email is working</strong>.</p>',
      cfg,
    );
    await audit(req.user!.id, 'settings.integrations.test', 'system', undefined, {
      channel: 'email',
      provider: cfg.provider,
    });
    res.json({ ok: true, provider: cfg.provider, to: me.email });
  }),
);

/* ------------------------------------------------------------ social links */

/**
 * The operator's social handles, rendered in the marketing footer. CONTENT
 * area, not SUPERADMIN: this is public copy, and whoever owns the copy should
 * own the links.
 */
adminRouter.get(
  '/social',
  asyncHandler(async (_req, res) => {
    res.json({ social: await getSocialSettingsAdmin() });
  }),
);

const socialLinkSchema = z.object({
  id: z.string().trim().min(1).max(64),
  platform: z.string().trim().min(1).max(40),
  label: z.string().trim().min(1).max(80),
  url: z.string().trim().url().max(2000),
  handle: z.string().trim().max(80).default(''),
  enabled: z.boolean(),
  sortOrder: z.number().int().min(0).max(9999),
});

const socialSchema = z.object({
  links: z.array(socialLinkSchema).max(30),
});

adminRouter.put(
  '/social',
  asyncHandler(async (req, res) => {
    const body = socialSchema.parse(req.body);
    const social = await saveSocialSettings(body);
    await audit(req.user!.id, 'settings.social.update', 'system', undefined, {
      links: social.links.map((l) => `${l.platform}:${l.url}`),
    });
    res.json({ social });
  }),
);

/* -------------------------------------------------------- platform fee ledger */

/**
 * The collected-fee ledger plus its whole-table totals. SUPERADMIN-only: this
 * is operator revenue, not member data.
 */
adminRouter.get(
  '/platform-fees',
  requireSuperAdmin,
  asyncHandler(async (req, res) => {
    const status = req.query.status === 'PENDING' || req.query.status === 'SETTLED'
      ? req.query.status
      : undefined;
    const [fees, summary] = await Promise.all([
      listPlatformFees({ status }),
      platformFeeSummary(),
    ]);
    res.json({ fees, summary });
  }),
);

const settleFeesSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(1000),
  note: z.string().max(500).optional(),
});

/** Mark specific fees settled after the operator has moved the funds by hand. */
adminRouter.post(
  '/platform-fees/settle',
  requireSuperAdmin,
  asyncHandler(async (req, res) => {
    const body = settleFeesSchema.parse(req.body);
    const result = await settlePlatformFees({
      ids: body.ids,
      adminId: req.user!.id,
      note: body.note,
    });
    await audit(req.user!.id, 'platform_fees.settle', 'system', undefined, {
      requested: body.ids.length,
      settled: result.settled,
    });
    res.json({ result });
  }),
);

/** Settle every PENDING fee — the "sweep the wallet" action. */
adminRouter.post(
  '/platform-fees/settle-all',
  requireSuperAdmin,
  asyncHandler(async (req, res) => {
    const body = z.object({ note: z.string().max(500).optional() }).parse(req.body ?? {});
    const result = await settleAllPendingFees({ adminId: req.user!.id, note: body.note });
    await audit(req.user!.id, 'platform_fees.settle_all', 'system', undefined, result);
    res.json({ result });
  }),
);

/* -------------------------------------------------------------------- KYC/AML */

/** The verification queue. Staff-level: reviewing identity is routine ops. */
adminRouter.get(
  '/kyc',
  asyncHandler(async (req, res) => {
    const status =
      req.query.status === 'PENDING' ||
      req.query.status === 'VERIFIED' ||
      req.query.status === 'REJECTED' ||
      req.query.status === 'NOT_STARTED'
        ? req.query.status
        : undefined;
    const submissions = await listKycSubmissions({ status });
    res.json({ submissions });
  }),
);

const kycReviewSchema = z.object({
  decision: z.enum(['VERIFIED', 'REJECTED']),
  reason: z.string().max(500).optional(),
});

/** Approve or reject a member's identity submission. */
adminRouter.post(
  '/kyc/:userId/review',
  asyncHandler(async (req, res) => {
    const body = kycReviewSchema.parse(req.body);
    const kyc = await reviewKyc({
      userId: req.params.userId!,
      adminId: req.user!.id,
      decision: body.decision,
      reason: body.reason,
    });
    await audit(req.user!.id, 'kyc.review', 'user', req.params.userId, {
      decision: body.decision,
    });
    res.json({ kyc });
  }),
);

const MAX_CONTENT_BYTES = 100_000;

adminRouter.put(
  '/settings/content',
  requireSuperAdmin,
  asyncHandler(async (req, res) => {
    const body = z.object({ content: z.unknown() }).parse(req.body);
    const content = body.content;
    if (typeof content !== 'object' || content === null || Array.isArray(content)) {
      throw ApiError.badRequest('content must be a JSON object', 'INVALID_CONTENT');
    }
    if (JSON.stringify(content).length > MAX_CONTENT_BYTES) {
      throw ApiError.badRequest('content is too large', 'CONTENT_TOO_LARGE');
    }
    await saveSiteContent(content as Record<string, unknown>);
    await audit(req.user!.id, 'settings.content.update', 'system');
    res.json({ content });
  }),
);

/* ---------------------------------------------------------- notifications */

const broadcastSchema = z.object({
  title: z.string().min(1).max(140),
  body: z.string().min(1).max(4000),
  link: z.string().max(300).nullable().optional(),
  audience: z.enum(BROADCAST_AUDIENCES),
  sendEmail: z.boolean().optional(),
});

/**
 * Post an announcement to a slice of the user base. Staff-level (ADMIN or
 * SUPERADMIN) — running comms is routine operations, not a structural change.
 */
adminRouter.post(
  '/notifications/broadcast',
  asyncHandler(async (req, res) => {
    const body = broadcastSchema.parse(req.body);
    const result = await dispatchBroadcast(body);
    await audit(req.user!.id, 'notification.broadcast', 'system', undefined, {
      title: body.title,
      audience: body.audience,
      ...result,
    });
    res.status(201).json({ result });
  }),
);

/** Broadcast history, read back from the audit trail (the delivery record). */
adminRouter.get(
  '/notifications',
  asyncHandler(async (_req, res) => {
    const rows = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, 'notification.broadcast'))
      .orderBy(desc(schema.auditLog.createdAt))
      .limit(50);
    res.json({ broadcasts: rows });
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
