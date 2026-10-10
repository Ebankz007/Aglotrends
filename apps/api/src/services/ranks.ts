import {
  CREDIT_TYPE,
  evaluateAssociateRank,
  evaluateLeadershipRank,
  payFromPool,
} from '@aglotrends/engine';
import { eq } from 'drizzle-orm';
import { db, schema } from '../db.js';
import { insertPoolEntry, poolBalance } from './pools.js';
import { loadNetworkIndex } from './network.js';
import { creditWallet } from './wallet.js';

export interface RankEvalResult {
  associatePaid: number;
  associateFlagged: number;
  leadershipAwarded: number;
}

/**
 * §5/§6/§10 — evaluate every member for newly-qualified Associate and Leadership
 * ranks. Associate rewards pay from the Rank pool (or are FLAGGED when the pool
 * cannot cover them); Leadership rewards are non-cash SKUs recorded for fulfilment.
 *
 * Associate ranks are applied first, then the index is rebuilt so Leadership's
 * leg-spread rule sees members' freshly-updated Associate ranks.
 */
export async function runRankEvaluation(): Promise<RankEvalResult> {
  // Pass 1 — Associate ranks.
  let index = await loadNetworkIndex(db);
  const associate: Array<{ memberId: string; rankId: number; rewardCents: number }> = [];
  for (const m of index.byId.values()) {
    const q = evaluateAssociateRank(index, m.id);
    if (q) associate.push({ memberId: m.id, ...q });
  }

  let associatePaid = 0;
  let associateFlagged = 0;
  if (associate.length > 0) {
    await db.transaction(async (tx) => {
      for (const a of associate) {
        const balance = await poolBalance(tx, 'RANK');
        const decision = payFromPool(balance, a.rewardCents);
        if (decision.status === 'PAID') {
          await insertPoolEntry(tx, 'RANK', 'PAYOUT', a.rewardCents, decision.balanceCents, 'rank_award', a.memberId);
          await creditWallet(tx, {
            userId: a.memberId,
            amountCents: a.rewardCents,
            type: CREDIT_TYPE.rankMilestone,
            refType: 'rank_award',
            refId: a.memberId,
            description: `Associate Rank ${a.rankId}`,
          });
          await tx.insert(schema.rankAwards).values({
            userId: a.memberId,
            kind: 'ASSOCIATE',
            rankId: a.rankId,
            rewardCents: a.rewardCents,
            status: 'PAID',
            paidAt: new Date(),
          });
          await tx
            .update(schema.users)
            .set({ highestAssociateRank: a.rankId, updatedAt: new Date() })
            .where(eq(schema.users.id, a.memberId));
          associatePaid += 1;
        } else {
          await tx.insert(schema.rankAwards).values({
            userId: a.memberId,
            kind: 'ASSOCIATE',
            rankId: a.rankId,
            rewardCents: a.rewardCents,
            status: 'FLAGGED',
          });
          associateFlagged += 1;
        }
      }
    });
  }

  // Pass 2 — Leadership ranks (index rebuilt to see updated Associate ranks).
  index = await loadNetworkIndex(db);
  const leadership: Array<{ memberId: string; rankId: number; name: string; rewardSku: string }> = [];
  for (const m of index.byId.values()) {
    const q = evaluateLeadershipRank(index, m.id);
    if (q) leadership.push({ memberId: m.id, ...q });
  }

  let leadershipAwarded = 0;
  if (leadership.length > 0) {
    await db.transaction(async (tx) => {
      for (const l of leadership) {
        await tx.insert(schema.rankAwards).values({
          userId: l.memberId,
          kind: 'LEADERSHIP',
          rankId: l.rankId,
          rewardSku: l.rewardSku,
          status: 'APPROVED',
        });
        await tx
          .update(schema.users)
          .set({ highestLeadershipRank: l.rankId, updatedAt: new Date() })
          .where(eq(schema.users.id, l.memberId));
        leadershipAwarded += 1;
      }
    });
  }

  return { associatePaid, associateFlagged, leadershipAwarded };
}
