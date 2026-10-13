import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { db, schema, type Tx } from '../db.js';
import { ApiError } from '../lib/errors.js';
import type { PaymentPurpose } from './payment-service.js';

/**
 * Platform transaction fees — the flat fee ($3.00 by default) withheld from
 * every inbound gateway payment and routed to the operator's own wallet.
 *
 * This is PLATFORM REVENUE, entirely separate from the compensation plan. The
 * fee is carved out before the engine runs, so the $20 registration base and
 * its 45/55 split are untouched.
 *
 * Settlement is MANUAL by design: the operator moves the funds on-chain and
 * marks the rows settled here. There is no automated sweep — the platform never
 * holds a key to the destination wallet.
 */

export interface RecordPlatformFeeInput {
  userId: string;
  paymentId: string;
  purpose: PaymentPurpose;
  amountCents: number;
  currency?: string;
  walletAddress: string;
  network: string;
  asset: string;
}

/**
 * Record a collected fee. Idempotent on `payment_id` — a webhook replay is a
 * no-op, so a fee can never be double-counted. A zero/negative fee writes
 * nothing (the fee may be disabled, or the charge may be fee-exempt).
 *
 * Runs inside the caller's transaction so the fee row and the PAID status land
 * together, or neither does.
 */
export async function recordPlatformFee(tx: Tx, input: {
  userId: string;
  paymentId: string;
  purpose: PaymentPurpose;
  amountCents: number;
  currency?: string;
  walletAddress: string;
  network: string;
  asset: string;
}): Promise<void> {
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) return;

  await tx
    .insert(schema.platformFees)
    .values({
      userId: input.userId,
      paymentId: input.paymentId,
      purpose: input.purpose,
      amountCents: input.amountCents,
      currency: input.currency ?? 'USDT',
      walletAddress: input.walletAddress,
      network: input.network,
      asset: input.asset,
      status: 'PENDING',
    })
    // The unique index on payment_id is the idempotency token: a webhook replay
    // that reaches this line again inserts nothing.
    .onConflictDoNothing({ target: schema.platformFees.paymentId });
}

export interface PlatformFeeRow {
  id: string;
  userId: string;
  userEmail: string | null;
  paymentId: string | null;
  purpose: string;
  amountCents: number;
  currency: string;
  walletAddress: string;
  network: string;
  asset: string;
  status: string;
  settledAt: Date | null;
  settledBy: string | null;
  note: string | null;
  createdAt: Date;
}

/** The operator's fee ledger, newest first, joined to the paying member. */
export async function listPlatformFees(options?: {
  status?: 'PENDING' | 'SETTLED';
  limit?: number;
}): Promise<PlatformFeeRow[]> {
  const limit = Math.min(Math.max(options?.limit ?? 200, 1), 1000);
  const where = options?.status ? eq(schema.platformFees.status, options.status) : undefined;

  const rows = await db
    .select({
      id: schema.platformFees.id,
      userId: schema.platformFees.userId,
      userEmail: schema.users.email,
      paymentId: schema.platformFees.paymentId,
      purpose: schema.platformFees.purpose,
      amountCents: schema.platformFees.amountCents,
      currency: schema.platformFees.currency,
      walletAddress: schema.platformFees.walletAddress,
      network: schema.platformFees.network,
      asset: schema.platformFees.asset,
      status: schema.platformFees.status,
      settledAt: schema.platformFees.settledAt,
      settledBy: schema.platformFees.settledBy,
      note: schema.platformFees.note,
      createdAt: schema.platformFees.createdAt,
    })
    .from(schema.platformFees)
    .leftJoin(schema.users, eq(schema.users.id, schema.platformFees.userId))
    .where(where)
    .orderBy(desc(schema.platformFees.createdAt))
    .limit(limit);

  return rows;
}

export interface PlatformFeeSummary {
  totalCents: number;
  pendingCents: number;
  settledCents: number;
  totalCount: number;
  pendingCount: number;
  settledCount: number;
}

/**
 * Totals over the WHOLE table, not the visible page. A summary computed from a
 * paginated window silently lies the moment the ledger exceeds the page size —
 * which is exactly when the operator needs it to be right.
 */
export async function platformFeeSummary(): Promise<PlatformFeeSummary> {
  const [row] = await db
    .select({
      totalCents: sql<number>`coalesce(sum(${schema.platformFees.amountCents}), 0)::int`,
      pendingCents: sql<number>`coalesce(sum(${schema.platformFees.amountCents}) filter (where ${schema.platformFees.status} = 'PENDING'), 0)::int`,
      settledCents: sql<number>`coalesce(sum(${schema.platformFees.amountCents}) filter (where ${schema.platformFees.status} = 'SETTLED'), 0)::int`,
      totalCount: sql<number>`count(*)::int`,
      pendingCount: sql<number>`(count(*) filter (where ${schema.platformFees.status} = 'PENDING'))::int`,
      settledCount: sql<number>`(count(*) filter (where ${schema.platformFees.status} = 'SETTLED'))::int`,
    })
    .from(schema.platformFees);

  return (
    row ?? {
      totalCents: 0,
      pendingCents: 0,
      settledCents: 0,
      totalCount: 0,
      pendingCount: 0,
      settledCount: 0,
    }
  );
}

/**
 * Mark fees SETTLED after the operator has moved the funds by hand.
 *
 * Only PENDING rows transition — settling twice is a no-op, not an error, so a
 * double-click cannot corrupt the ledger. Returns how many rows actually moved.
 */
export async function settlePlatformFees(input: {
  ids: string[];
  adminId: string;
  note?: string;
}): Promise<{ settled: number }> {
  if (input.ids.length === 0) throw ApiError.badRequest('No fee ids provided', 'INVALID_INPUT');

  const now = new Date();
  const updated = await db
    .update(schema.platformFees)
    .set({
      status: 'SETTLED',
      settledAt: now,
      settledBy: input.adminId,
      note: input.note ?? null,
    })
    .where(
      and(
        inArray(schema.platformFees.id, input.ids),
        eq(schema.platformFees.status, 'PENDING'),
      ),
    )
    .returning({ id: schema.platformFees.id });

  return { settled: updated.length };
}

/** Settle every PENDING fee in one action — the "sweep the wallet" button. */
export async function settleAllPendingFees(input: {
  adminId: string;
  note?: string;
}): Promise<{ settled: number }> {
  const now = new Date();
  const updated = await db
    .update(schema.platformFees)
    .set({
      status: 'SETTLED',
      settledAt: now,
      settledBy: input.adminId,
      note: input.note ?? null,
    })
    .where(eq(schema.platformFees.status, 'PENDING'))
    .returning({ id: schema.platformFees.id });

  return { settled: updated.length };
}
