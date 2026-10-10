import { describe, expect, it } from 'vitest';
import {
  accruePools,
  canPayFromPool,
  leadershipPoolContributionCents,
  payFromPool,
  rankPoolContributionCents,
} from '../src/index.js';

describe('§10 pools', () => {
  it('accrues the documented contributions per registration', () => {
    expect(rankPoolContributionCents(2000)).toBe(160); // 8% of $20
    expect(leadershipPoolContributionCents(2000)).toBe(140); // 7% of $20
  });

  it('accumulates across registrations', () => {
    let pools = { rankPoolCents: 0, leadershipPoolCents: 0 };
    for (let i = 0; i < 100; i += 1) pools = accruePools(pools, 2000);
    expect(pools.rankPoolCents).toBe(16000);
    expect(pools.leadershipPoolCents).toBe(14000);
  });

  it('pays a reward when the pool is funded', () => {
    const decision = payFromPool(20000, 1400);
    expect(decision.status).toBe('PAID');
    if (decision.status === 'PAID') {
      expect(decision.paidCents).toBe(1400);
      expect(decision.balanceCents).toBe(18600);
    }
  });

  it('flags a reward when the pool is underfunded (never over-pays)', () => {
    const decision = payFromPool(100, 1400);
    expect(decision.status).toBe('FLAGGED');
    if (decision.status === 'FLAGGED') {
      expect(decision.balanceCents).toBe(100); // unchanged
      expect(decision.requiredCents).toBe(1400);
    }
  });

  it('canPayFromPool is exact at the boundary', () => {
    expect(canPayFromPool(1400, 1400)).toBe(true);
    expect(canPayFromPool(1399, 1400)).toBe(false);
  });
});
