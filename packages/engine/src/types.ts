/**
 * Aglotrends Compensation Engine — Domain Types
 */

/** §2 — result of splitting a registration fee. All values integer cents. */
export interface FeeAllocation {
  readonly companyReserveCents: number;
  readonly directReferralPoolCents: number;
  readonly generationPoolCents: number;
  readonly rankPoolContributionCents: number;
  readonly leadershipPoolContributionCents: number;
}

/** §7 — result of splitting realized trading profit. All values integer cents. */
export interface TradingProfitShares {
  readonly clientCents: number;
  readonly sponsorCents: number;
  readonly companyCents: number;
}

/** A wallet credit produced by the engine, to be persisted by the caller. */
export interface WalletCredit {
  readonly memberId: string;
  readonly amountCents: number;
  readonly type: string;
  readonly sourceMemberId: string;
}

/**
 * A member as the engine sees them. The engine never touches a database — the
 * caller supplies a flat list of these and the engine builds a network index.
 */
export interface MemberNode {
  readonly id: string;
  readonly sponsorId: string | null;
  /** §9.1 — good standing per the activity policy. */
  readonly isActive: boolean;
  /** §5/§9.3 — highest Associate Rank ever achieved (0 = none). Permanent. */
  readonly highestAssociateRank: number;
  /** §6/§9.3 — highest Leadership Rank ever achieved (0 = none). Permanent. */
  readonly highestLeadershipRank: number;
}

/** A sponsor-tree index, built once from a flat member list. */
export interface NetworkIndex {
  readonly byId: ReadonlyMap<string, MemberNode>;
  /** sponsorId -> direct referral (PEM) ids, in insertion order. */
  readonly children: ReadonlyMap<string, readonly string[]>;
}

/** §5 — an Associate Rank the member newly qualifies for. */
export interface AssociateRankQualification {
  readonly rankId: number;
  readonly rewardCents: number;
}

/** §6 — a Leadership Rank the member newly qualifies for. */
export interface LeadershipRankQualification {
  readonly rankId: number;
  readonly name: string;
  readonly rewardSku: string;
}

/** §10 — shared, accumulating pools. Integer cents. */
export interface PoolBalances {
  readonly rankPoolCents: number;
  readonly leadershipPoolCents: number;
}

/** §10 — outcome of attempting a pool payout. */
export type PoolPayoutDecision =
  | { readonly status: 'PAID'; readonly balanceCents: number; readonly paidCents: number }
  | { readonly status: 'FLAGGED'; readonly balanceCents: number; readonly requiredCents: number };
