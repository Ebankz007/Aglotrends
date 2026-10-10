/**
 * Aglotrends Compensation Engine — Pools (§10 Reserve / Sustainability Model)
 *
 * The Rank and Leadership pools are shared and accumulating, funded by ALL
 * registrations company-wide. Before a milestone pays out, the pool balance MUST
 * cover the reward; if not, the payout is flagged for admin review rather than
 * auto-paid past the accrued balance.
 */
import { COMMUNITY_POOL_SPLIT_BPS } from './constants.js';
import { bpsOf } from './money.js';
import type { PoolBalances, PoolPayoutDecision } from './types.js';

/** §10 — accrue a registration fee's Rank + Leadership contributions into the pools. */
export function accruePools(
  balances: PoolBalances,
  feeCents: number,
): PoolBalances {
  return {
    rankPoolCents: balances.rankPoolCents + bpsOf(feeCents, COMMUNITY_POOL_SPLIT_BPS.rank),
    leadershipPoolCents:
      balances.leadershipPoolCents + bpsOf(feeCents, COMMUNITY_POOL_SPLIT_BPS.leadership),
  };
}

/** §10 — the amount a single registration adds to the Rank pool. */
export function rankPoolContributionCents(feeCents: number): number {
  return bpsOf(feeCents, COMMUNITY_POOL_SPLIT_BPS.rank);
}

/** §10 — the amount a single registration adds to the Leadership pool. */
export function leadershipPoolContributionCents(feeCents: number): number {
  return bpsOf(feeCents, COMMUNITY_POOL_SPLIT_BPS.leadership);
}

/** §10 — true if the pool balance can cover the reward. */
export function canPayFromPool(balanceCents: number, rewardCents: number): boolean {
  return balanceCents >= rewardCents;
}

/**
 * §10 — attempt to pay `rewardCents` from a pool balance.
 * Returns PAID (with the reduced balance) when funded, else FLAGGED (balance
 * unchanged) so the caller can queue it for admin approval.
 */
export function payFromPool(balanceCents: number, rewardCents: number): PoolPayoutDecision {
  if (canPayFromPool(balanceCents, rewardCents)) {
    return { status: 'PAID', balanceCents: balanceCents - rewardCents, paidCents: rewardCents };
  }
  return { status: 'FLAGGED', balanceCents, requiredCents: rewardCents };
}
