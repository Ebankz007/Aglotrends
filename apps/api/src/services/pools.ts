import { eq, sql } from 'drizzle-orm';
import { schema } from '../db.js';
import type { DbLike, Tx } from '../db.js';
import type { PoolBalances } from '@aglotrends/engine';

type PoolKind = 'RANK' | 'LEADERSHIP';

/** Current balance of a pool = sum(accruals) - sum(payouts). */
export async function poolBalance(db: DbLike, pool: PoolKind): Promise<number> {
  const [row] = await db
    .select({
      total: sql<string>`coalesce(sum(case when ${schema.poolLedger.entryType} = 'ACCRUAL' then ${schema.poolLedger.amountCents} else -${schema.poolLedger.amountCents} end), 0)`,
    })
    .from(schema.poolLedger)
    .where(eq(schema.poolLedger.pool, pool));
  return Number(row?.total ?? 0);
}

export async function poolBalances(db: DbLike): Promise<PoolBalances> {
  const [rankPoolCents, leadershipPoolCents] = await Promise.all([
    poolBalance(db, 'RANK'),
    poolBalance(db, 'LEADERSHIP'),
  ]);
  return { rankPoolCents, leadershipPoolCents };
}

/** Append a pool ledger entry, recording the resulting balance. */
export async function insertPoolEntry(
  tx: Tx,
  pool: PoolKind,
  entryType: 'ACCRUAL' | 'PAYOUT',
  amountCents: number,
  balanceAfterCents: number,
  refType?: string,
  refId?: string,
): Promise<void> {
  await tx.insert(schema.poolLedger).values({
    pool,
    entryType,
    amountCents,
    balanceAfterCents,
    refType: refType ?? null,
    refId: refId ?? null,
  });
}

/** Accrue a registration's contribution into both pools. */
export async function accruePools(
  tx: Tx,
  rankContributionCents: number,
  leadershipContributionCents: number,
  refId: string,
): Promise<void> {
  if (rankContributionCents > 0) {
    const bal = await poolBalance(tx, 'RANK');
    await insertPoolEntry(tx, 'RANK', 'ACCRUAL', rankContributionCents, bal + rankContributionCents, 'registration', refId);
  }
  if (leadershipContributionCents > 0) {
    const bal = await poolBalance(tx, 'LEADERSHIP');
    await insertPoolEntry(tx, 'LEADERSHIP', 'ACCRUAL', leadershipContributionCents, bal + leadershipContributionCents, 'registration', refId);
  }
}
