import { describe, expect, it } from 'vitest';
import {
  allocateRegistrationFee,
  FEE_SPLIT_TOTAL,
  PROFIT_SPLIT_TOTAL,
  REGISTRATION_FEE_CENTS,
} from '../src/index.js';

describe('§2 registration fee allocation', () => {
  it('splits the default $20 fee into the documented buckets', () => {
    const a = allocateRegistrationFee();
    expect(a.companyReserveCents).toBe(900); // 45%
    expect(a.directReferralPoolCents).toBe(600); // 30%
    expect(a.generationPoolCents).toBe(200); // 10%
    expect(a.rankPoolContributionCents).toBe(160); // 8%
    expect(a.leadershipPoolContributionCents).toBe(140); // 7%
  });

  it('reconciles reserve + community to the full fee', () => {
    const a = allocateRegistrationFee(REGISTRATION_FEE_CENTS);
    const community =
      a.directReferralPoolCents +
      a.generationPoolCents +
      a.rankPoolContributionCents +
      a.leadershipPoolContributionCents;
    expect(a.companyReserveCents + community).toBe(REGISTRATION_FEE_CENTS);
    expect(community).toBe(1100); // 55% of $20
  });

  it('reconciles for an arbitrary fee (largest-remainder rounding, no lost cents)', () => {
    for (const fee of [1, 7, 99, 123, 2001, 3333, 10000, 99999]) {
      const a = allocateRegistrationFee(fee);
      const total =
        a.companyReserveCents +
        a.directReferralPoolCents +
        a.generationPoolCents +
        a.rankPoolContributionCents +
        a.leadershipPoolContributionCents;
      expect(total).toBe(fee);
    }
  });

  it('rejects a non-positive or non-integer fee', () => {
    expect(() => allocateRegistrationFee(0)).toThrow();
    expect(() => allocateRegistrationFee(-5)).toThrow();
    expect(() => allocateRegistrationFee(20.5)).toThrow();
  });
});

describe('§12 reconciliation invariants', () => {
  it('the five fee buckets sum to exactly 100%', () => {
    expect(FEE_SPLIT_TOTAL).toBe(1);
  });

  it('the three profit buckets sum to exactly 100%', () => {
    expect(PROFIT_SPLIT_TOTAL).toBe(1);
  });
});
