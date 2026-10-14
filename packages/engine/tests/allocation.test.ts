import { describe, expect, it } from 'vitest';
import {
  allocateRegistrationFee,
  FEE_SPLIT_TOTAL,
  PLATFORM_FEE_CENTS,
  PROFIT_SPLIT_TOTAL,
  REGISTRATION_FEE_CENTS,
  REGISTRATION_GROSS_CENTS,
  splitPlatformFee,
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

describe('§1 (amended) platform transaction fee', () => {
  it('pins the $5.00 platform fee and the $25.00 registration gross', () => {
    expect(PLATFORM_FEE_CENTS).toBe(500);
    expect(REGISTRATION_GROSS_CENTS).toBe(2500);
    expect(REGISTRATION_GROSS_CENTS).toBe(REGISTRATION_FEE_CENTS + PLATFORM_FEE_CENTS);
  });

  it('carves the fee out of a gross charge and reconciles net + fee === gross', () => {
    const { netCents, feeCents } = splitPlatformFee(REGISTRATION_GROSS_CENTS);
    expect(netCents).toBe(REGISTRATION_FEE_CENTS);
    expect(feeCents).toBe(PLATFORM_FEE_CENTS);
    expect(netCents + feeCents).toBe(REGISTRATION_GROSS_CENTS);
  });

  it('never lets the fee enter the compensation split — net is the base', () => {
    const { netCents } = splitPlatformFee(2500);
    const a = allocateRegistrationFee(netCents);
    const total =
      a.companyReserveCents +
      a.directReferralPoolCents +
      a.generationPoolCents +
      a.rankPoolContributionCents +
      a.leadershipPoolContributionCents;
    // The engine only ever sees the $20 net, never the $25 gross.
    expect(netCents).toBe(2000);
    expect(total).toBe(2000);
  });

  it('supports a configurable fee and a zero fee', () => {
    expect(splitPlatformFee(2300, 500)).toEqual({ netCents: 1800, feeCents: 500 });
    expect(splitPlatformFee(2300, 0)).toEqual({ netCents: 2300, feeCents: 0 });
  });

  it('rejects a non-positive gross or a fee that exceeds it', () => {
    expect(() => splitPlatformFee(0)).toThrow();
    expect(() => splitPlatformFee(-1)).toThrow();
    expect(() => splitPlatformFee(20.5)).toThrow();
    expect(() => splitPlatformFee(2300, -1)).toThrow();
    expect(() => splitPlatformFee(2300, 2301)).toThrow();
  });
});
