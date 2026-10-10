import { eq } from 'drizzle-orm';
import { db, schema } from '../db.js';
import { ApiError } from '../lib/errors.js';
import { creditWallet, debitWallet } from './wallet.js';

export interface PayoutRequestInput {
  userId: string;
  amountCents: number;
  method?: string;
  details?: string;
}

/** Member requests a withdrawal. Funds are held (debited) immediately. */
export async function requestPayout(input: PayoutRequestInput) {
  return db.transaction(async (tx) => {
    const [payout] = await tx
      .insert(schema.payouts)
      .values({
        userId: input.userId,
        type: 'WITHDRAWAL',
        amountCents: input.amountCents,
        status: 'REQUESTED',
        method: input.method ?? null,
        details: input.details ?? null,
      })
      .returning();
    if (!payout) throw new Error('requestPayout: insert failed');

    await debitWallet(tx, {
      userId: input.userId,
      amountCents: input.amountCents,
      type: 'WITHDRAWAL_HOLD',
      refType: 'payout',
      refId: payout.id,
      description: 'Withdrawal requested (held)',
    });
    return payout;
  });
}

async function transition(
  payoutId: string,
  adminId: string,
  status: 'APPROVED' | 'REJECTED' | 'PAID',
) {
  return db.transaction(async (tx) => {
    const [payout] = await tx.select().from(schema.payouts).where(eq(schema.payouts.id, payoutId));
    if (!payout) throw ApiError.notFound('Payout not found');

    if (status === 'APPROVED' && payout.status !== 'REQUESTED') {
      throw ApiError.conflict(`Cannot approve a payout in status ${payout.status}`);
    }
    if (status === 'PAID' && payout.status !== 'APPROVED') {
      throw ApiError.conflict(`Cannot pay a payout in status ${payout.status}`);
    }
    if (status === 'REJECTED' && payout.status !== 'REQUESTED') {
      throw ApiError.conflict(`Cannot reject a payout in status ${payout.status}`);
    }

    if (status === 'REJECTED') {
      // Refund the held funds.
      await creditWallet(tx, {
        userId: payout.userId,
        amountCents: payout.amountCents,
        type: 'WITHDRAWAL_REFUND',
        refType: 'payout',
        refId: payout.id,
        description: 'Withdrawal rejected (refunded)',
      });
    }

    const [updated] = await tx
      .update(schema.payouts)
      .set({
        status,
        approvedBy: status === 'REJECTED' ? adminId : payout.approvedBy ?? adminId,
        approvedAt: status === 'REJECTED' ? new Date() : payout.approvedAt ?? new Date(),
        paidAt: status === 'PAID' ? new Date() : payout.paidAt,
      })
      .where(eq(schema.payouts.id, payoutId))
      .returning();
    return updated;
  });
}

export const approvePayout = (id: string, adminId: string) => transition(id, adminId, 'APPROVED');
export const rejectPayout = (id: string, adminId: string) => transition(id, adminId, 'REJECTED');
export const payPayout = (id: string, adminId: string) => transition(id, adminId, 'PAID');
