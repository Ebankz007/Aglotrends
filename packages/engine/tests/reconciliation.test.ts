import { describe, expect, it } from 'vitest';
import {
  allocateRegistrationFee,
  ASSOCIATE_RANKS,
  COMMUNITY_POOL_SPLIT_BPS,
  FEE_SPLIT_BPS,
  GENERATION_RATE_BPS,
  LEADERSHIP_RANKS,
  PROFIT_SPLIT_TOTAL,
  TRADING_PROFIT_SPLIT_BPS,
} from '../src/index.js';

describe('§12 consolidated reconciliation', () => {
  it('registration fee split sums to 100%', () => {
    const sum =
      FEE_SPLIT_BPS.companyReserve +
      COMMUNITY_POOL_SPLIT_BPS.directReferral +
      COMMUNITY_POOL_SPLIT_BPS.generation +
      COMMUNITY_POOL_SPLIT_BPS.rank +
      COMMUNITY_POOL_SPLIT_BPS.leadership;
    expect(sum).toBe(10_000);
  });

  it('trading profit split sums to 100%', () => {
    const sum =
      TRADING_PROFIT_SPLIT_BPS.client +
      TRADING_PROFIT_SPLIT_BPS.sponsor +
      TRADING_PROFIT_SPLIT_BPS.company;
    expect(sum).toBe(10_000);
    expect(PROFIT_SPLIT_TOTAL).toBe(1);
  });

  it('generation rates sum to the generation pool (10% of fee)', () => {
    const sum =
      GENERATION_RATE_BPS[2] +
      GENERATION_RATE_BPS[3] +
      GENERATION_RATE_BPS[4] +
      GENERATION_RATE_BPS[5] +
      GENERATION_RATE_BPS[6];
    expect(sum).toBe(COMMUNITY_POOL_SPLIT_BPS.generation);
  });

  it('the four community sub-pools equal the community pool', () => {
    const community =
      COMMUNITY_POOL_SPLIT_BPS.directReferral +
      COMMUNITY_POOL_SPLIT_BPS.generation +
      COMMUNITY_POOL_SPLIT_BPS.rank +
      COMMUNITY_POOL_SPLIT_BPS.leadership;
    expect(community).toBe(FEE_SPLIT_BPS.communityPool);
  });

  it('worked example TC1 — single direct referral reconciles to $20', () => {
    const a = allocateRegistrationFee();
    // Amaka $6 direct + company $9 reserve + pools $3 + generation pool $2
    expect(a.directReferralPoolCents).toBe(600);
    expect(a.companyReserveCents).toBe(900);
    expect(a.rankPoolContributionCents + a.leadershipPoolContributionCents).toBe(300);
    expect(a.generationPoolCents).toBe(200);
    expect(
      a.directReferralPoolCents +
        a.companyReserveCents +
        a.rankPoolContributionCents +
        a.leadershipPoolContributionCents +
        a.generationPoolCents,
    ).toBe(2000);
  });

  it('rank tables are monotonic and leadership gates are consistent', () => {
    for (let i = 1; i < ASSOCIATE_RANKS.length; i += 1) {
      expect(ASSOCIATE_RANKS[i]!.minPersonalReferrals).toBeGreaterThan(
        ASSOCIATE_RANKS[i - 1]!.minPersonalReferrals,
      );
      expect(ASSOCIATE_RANKS[i]!.minTeamVolume).toBeGreaterThan(
        ASSOCIATE_RANKS[i - 1]!.minTeamVolume,
      );
      expect(ASSOCIATE_RANKS[i]!.rewardCents).toBeGreaterThan(
        ASSOCIATE_RANKS[i - 1]!.rewardCents,
      );
    }
    for (let i = 1; i < LEADERSHIP_RANKS.length; i += 1) {
      expect(LEADERSHIP_RANKS[i]!.requiredAssociateRank).toBeGreaterThan(
        LEADERSHIP_RANKS[i - 1]!.requiredAssociateRank,
      );
    }
  });
});
