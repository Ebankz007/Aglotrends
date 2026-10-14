/**
 * Aglotrends Compensation Engine — Global Constants (§1)
 *
 * Source: Aglotrends Compensation Plan, Calculation Logic Extraction.
 * Money is integer cents everywhere. Percentages are integer basis points
 * (1% = 100 bps, 100% = 10_000 bps). Never use floats for money.
 */

/** §1 — one-time fee paid by every new member on signup. $20.00. */
export const REGISTRATION_FEE_CENTS = 2000;

/**
 * §1 (amended 2026-10-14) — platform transaction fee added to EVERY inbound
 * gateway payment. $5.00.
 *
 * This is PLATFORM REVENUE, not compensation. It is carved out of the gross
 * charge BEFORE the compensation split runs, so `REGISTRATION_FEE_CENTS` (the
 * $20 base that drives the 45/55 allocation) is untouched. A registration
 * therefore charges $25.00: $20.00 into the plan, $5.00 to the operator wallet.
 */
export const PLATFORM_FEE_CENTS = 500;

/** §1 (amended 2026-10-14) — the gross amount charged for a registration: $20.00 + $5.00. */
export const REGISTRATION_GROSS_CENTS = REGISTRATION_FEE_CENTS + PLATFORM_FEE_CENTS;

/** §1 — minimum a client must fund into their OWN broker account to activate copy-trading. Not revenue. */
export const MIN_FUNDING_CENTS = 5000;

/** §1/§8 — max direct placements per matrix position (3x3 matrix). */
export const MATRIX_WIDTH = 3;

/** §1/§8 — max levels wide/deep from a sponsor before overflow. */
export const MATRIX_DEPTH = 3;

/** §1/§4 — generation bonus applies to downline levels 2 through 6. */
export const GENERATION_MIN = 2;
export const GENERATION_MAX = 6;

/** §1/§5 — no single leg may contribute more than 40% of team volume. */
export const MAX_LEG_CONTRIBUTION_BPS = 4000;

/** §2 — top-level split of the registration fee. Sums to 10_000 bps. */
export const FEE_SPLIT_BPS = {
  companyReserve: 4500, // 45% -> $9.00 on $20
  communityPool: 5500, // 55% -> $11.00 on $20
} as const;

/**
 * §2 — the community pool ($11.00) split into four sub-pools. These are
 * percentages OF THE FEE (30% of $20 = $6.00), and sum to the community pool
 * (30 + 10 + 8 + 7 = 55% of the fee).
 */
export const COMMUNITY_POOL_SPLIT_BPS = {
  directReferral: 3000, // 30% -> $6.00
  generation: 1000, // 10% -> $2.00
  rank: 800, //  8% -> $1.60
  leadership: 700, //  7% -> $1.40
} as const;

/** §4 — generation override rates, as % of fee. Sums to 1000 bps (10%). */
export const GENERATION_RATE_BPS = {
  2: 400, // 4.0% -> $0.80
  3: 200, // 2.0% -> $0.40
  4: 150, // 1.5% -> $0.30
  5: 150, // 1.5% -> $0.30
  6: 100, // 1.0% -> $0.20
} as const;

/** §7 — realized trading-profit split. Sums to 10_000 bps. */
export const TRADING_PROFIT_SPLIT_BPS = {
  client: 6000, // 60%
  sponsor: 1000, // 10%
  company: 3000, // 30%
} as const;

/** §5 — Associate Rank milestones. Team volume is measured in downline members. */
export interface AssociateRankDef {
  readonly rankId: number;
  readonly minPersonalReferrals: number;
  readonly minTeamVolume: number;
  readonly rewardCents: number;
}

export const ASSOCIATE_RANKS: readonly AssociateRankDef[] = [
  { rankId: 1, minPersonalReferrals: 3, minTeamVolume: 12, rewardCents: 1400 },
  { rankId: 2, minPersonalReferrals: 7, minTeamVolume: 40, rewardCents: 3200 },
  { rankId: 3, minPersonalReferrals: 15, minTeamVolume: 130, rewardCents: 10000 },
  { rankId: 4, minPersonalReferrals: 25, minTeamVolume: 700, rewardCents: 28000 },
  { rankId: 5, minPersonalReferrals: 35, minTeamVolume: 2500, rewardCents: 80000 },
  { rankId: 6, minPersonalReferrals: 60, minTeamVolume: 6000, rewardCents: 240000 },
  { rankId: 7, minPersonalReferrals: 100, minTeamVolume: 17000, rewardCents: 1000000 },
  { rankId: 8, minPersonalReferrals: 150, minTeamVolume: 60000, rewardCents: 2000000 },
];

/** §6 — Leadership Ranks. Rewards are NON-CASH SKUs, not currency amounts. */
export interface LeadershipRankDef {
  readonly rankId: number;
  readonly name: string;
  readonly requiredAssociateRank: number;
  readonly minLegs: number;
  readonly minTeamMembers: number;
  readonly rewardSku: string;
}

export const LEADERSHIP_RANKS: readonly LeadershipRankDef[] = [
  { rankId: 1, name: 'Bronze Leader', requiredAssociateRank: 3, minLegs: 2, minTeamMembers: 3, rewardSku: 'SMARTPHONE' },
  { rankId: 2, name: 'Silver Leader', requiredAssociateRank: 4, minLegs: 2, minTeamMembers: 3, rewardSku: 'LAPTOP' },
  { rankId: 3, name: 'Gold Leader', requiredAssociateRank: 5, minLegs: 2, minTeamMembers: 3, rewardSku: 'LUXURY_WATCH' },
  { rankId: 4, name: 'Platinum Leader', requiredAssociateRank: 6, minLegs: 2, minTeamMembers: 3, rewardSku: 'INTERNATIONAL_TRIP' },
  { rankId: 5, name: 'Diamond Leader', requiredAssociateRank: 7, minLegs: 2, minTeamMembers: 3, rewardSku: 'LUXURY_VEHICLE' },
  { rankId: 6, name: 'Crown Diamond', requiredAssociateRank: 8, minLegs: 2, minTeamMembers: 3, rewardSku: 'HOME_APARTMENT' },
];

/** §9.2 — compression window: how far up the tree a skipped payout may travel. */
export const COMPRESSION_STOP_AT_GEN = 6;

/** Ledger / wallet credit types emitted by the engine. */
export const CREDIT_TYPE = {
  directReferral: 'DIRECT_REFERRAL_BONUS',
  generation: (gen: number) => `GENERATION_BONUS_GEN${gen}`,
  rankMilestone: 'RANK_MILESTONE',
  sponsorOverride: 'SPONSOR_OVERRIDE',
  tradingProfitRetained: 'TRADING_PROFIT_RETAINED',
} as const;

/** Company revenue types. */
export const REVENUE_TYPE = {
  registrationReserve: 'REGISTRATION_OPERATING_RESERVE',
  tradingPerformanceShare: 'TRADING_PERFORMANCE_SHARE',
} as const;
