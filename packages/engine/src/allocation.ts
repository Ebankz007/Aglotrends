/**
 * Aglotrends Compensation Engine — Registration Fee Allocation (§2)
 * and Trading Profit Sharing (§7).
 *
 * These are the two fully-specified money functions in the plan, with the
 * reconciliation invariants (§12) enforced in-code. All values are integer cents.
 */
import {
  COMMUNITY_POOL_SPLIT_BPS,
  FEE_SPLIT_BPS,
  REGISTRATION_FEE_CENTS,
  TRADING_PROFIT_SPLIT_BPS,
} from './constants.js';
import { splitByBps } from './money.js';
import type { FeeAllocation, TradingProfitShares } from './types.js';

/** §12 invariant: the five fee buckets must reconcile to exactly 100%. */
export const FEE_SPLIT_TOTAL =
  (FEE_SPLIT_BPS.companyReserve +
    COMMUNITY_POOL_SPLIT_BPS.directReferral +
    COMMUNITY_POOL_SPLIT_BPS.generation +
    COMMUNITY_POOL_SPLIT_BPS.rank +
    COMMUNITY_POOL_SPLIT_BPS.leadership) /
  10_000;

/** §12 invariant: the three profit buckets must reconcile to exactly 100%. */
export const PROFIT_SPLIT_TOTAL =
  (TRADING_PROFIT_SPLIT_BPS.client +
    TRADING_PROFIT_SPLIT_BPS.sponsor +
    TRADING_PROFIT_SPLIT_BPS.company) /
  10_000;

/**
 * §2 — Split a registration fee into its five buckets.
 * Mirrors spec pseudocode `allocateRegistrationFee(fee = 20.00)`.
 *
 * @param feeCents Registration fee in cents. Defaults to REGISTRATION_FEE_CENTS (2000 = $20).
 * @throws if the split does not reconcile to the full fee (to the cent).
 */
export function allocateRegistrationFee(feeCents: number = REGISTRATION_FEE_CENTS): FeeAllocation {
  if (!Number.isInteger(feeCents) || feeCents <= 0) {
    throw new Error(`allocateRegistrationFee: feeCents must be a positive integer, got ${feeCents}`);
  }

  const [companyReserveCents, directReferralPoolCents, generationPoolCents, rankPoolContributionCents, leadershipPoolContributionCents] =
    splitByBps(feeCents, [
      FEE_SPLIT_BPS.companyReserve,
      COMMUNITY_POOL_SPLIT_BPS.directReferral,
      COMMUNITY_POOL_SPLIT_BPS.generation,
      COMMUNITY_POOL_SPLIT_BPS.rank,
      COMMUNITY_POOL_SPLIT_BPS.leadership,
    ]) as [number, number, number, number, number];

  const communityPool =
    directReferralPoolCents +
    generationPoolCents +
    rankPoolContributionCents +
    leadershipPoolContributionCents;
  const expectedCommunityPool = (feeCents * FEE_SPLIT_BPS.communityPool) / 10_000;

  // §12: reserve + community must equal the fee exactly. The community pool may
  // differ from its exact fractional share by at most 1 cent (largest-remainder
  // rounding), so that is the tolerance we enforce.
  if (
    companyReserveCents + communityPool !== feeCents ||
    Math.abs(communityPool - expectedCommunityPool) > 1
  ) {
    throw new Error(
      `allocateRegistrationFee: split does not reconcile. fee=${feeCents}, ` +
        `reserve=${companyReserveCents}, community=${communityPool}`,
    );
  }

  return {
    companyReserveCents,
    directReferralPoolCents,
    generationPoolCents,
    rankPoolContributionCents,
    leadershipPoolContributionCents,
  };
}

/**
 * §7 — Distribute realized trading profit: 60% client / 10% sponsor / 30% company.
 * Mirrors spec pseudocode `distributeTradingProfitShare(client, periodRealizedProfit)`.
 *
 * @param periodRealizedProfitCents Realized profit for the period, in cents.
 * @returns the three shares, or null if profit <= 0 (loss/breakeven -> NO split).
 * @throws if the shares do not reconcile to the profit, to the cent.
 */
export function distributeTradingProfitShare(
  periodRealizedProfitCents: number,
): TradingProfitShares | null {
  if (!Number.isInteger(periodRealizedProfitCents)) {
    throw new Error(
      `distributeTradingProfitShare: profit must be an integer number of cents, got ${periodRealizedProfitCents}`,
    );
  }

  // §7: loss or breakeven -> no split occurs, no party is paid or charged.
  if (periodRealizedProfitCents <= 0) return null;

  const [clientCents, sponsorCents, companyCents] = splitByBps(periodRealizedProfitCents, [
    TRADING_PROFIT_SPLIT_BPS.client,
    TRADING_PROFIT_SPLIT_BPS.sponsor,
    TRADING_PROFIT_SPLIT_BPS.company,
  ]) as [number, number, number];

  if (clientCents + sponsorCents + companyCents !== periodRealizedProfitCents) {
    throw new Error(
      `distributeTradingProfitShare: shares do not reconcile. profit=${periodRealizedProfitCents}, ` +
        `client=${clientCents}, sponsor=${sponsorCents}, company=${companyCents}`,
    );
  }

  return { clientCents, sponsorCents, companyCents };
}
