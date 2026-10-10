import { CREDIT_TYPE, distributeTradingProfitShare } from '@aglotrends/engine';
import { eq } from 'drizzle-orm';
import { db, schema } from '../db.js';
import { ApiError } from '../lib/errors.js';
import { creditWallet } from './wallet.js';

export interface SettlementInput {
  userId: string;
  periodStart: string; // YYYY-MM-DD
  periodEnd: string; // YYYY-MM-DD
  realizedProfitCents: number;
  recordedBy: string;
}

/**
 * §7 — record a client's realized trading profit for a period (admin-entered,
 * since copy-trading is manual and there is no live broker feed) and distribute
 * the 60/10/30 split. A loss or breakeven records the period with no payout.
 */
export async function recordProfitSettlement(input: SettlementInput) {
  return db.transaction(async (tx) => {
    const [member] = await tx
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, input.userId));
    if (!member) throw ApiError.notFound('Member not found');

    const shares = distributeTradingProfitShare(input.realizedProfitCents);

    const [row] = await tx
      .insert(schema.profitSettlements)
      .values({
        userId: input.userId,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        realizedProfitCents: input.realizedProfitCents,
        clientCents: shares?.clientCents ?? 0,
        sponsorCents: shares?.sponsorCents ?? 0,
        companyCents: shares?.companyCents ?? 0,
        status: shares ? 'DISTRIBUTED' : 'RECORDED',
        recordedBy: input.recordedBy,
      })
      .returning();
    if (!row) throw new Error('recordProfitSettlement: insert failed');

    if (shares) {
      await creditWallet(tx, {
        userId: input.userId,
        amountCents: shares.clientCents,
        type: CREDIT_TYPE.tradingProfitRetained,
        refType: 'settlement',
        refId: row.id,
        description: 'Trading profit — client share',
      });
      if (member.sponsorId && shares.sponsorCents > 0) {
        await creditWallet(tx, {
          userId: member.sponsorId,
          amountCents: shares.sponsorCents,
          type: CREDIT_TYPE.sponsorOverride,
          sourceUserId: input.userId,
          refType: 'settlement',
          refId: row.id,
          description: 'Trading profit — sponsor override',
        });
      }
    }

    return row;
  });
}
