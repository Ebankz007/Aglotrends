import { describe, expect, it } from 'vitest';
import { distributeTradingProfitShare } from '../src/index.js';

describe('§7 trading profit sharing', () => {
  it('splits $200 realized profit 60/10/30', () => {
    const s = distributeTradingProfitShare(20000);
    expect(s).not.toBeNull();
    expect(s!.clientCents).toBe(12000);
    expect(s!.sponsorCents).toBe(2000);
    expect(s!.companyCents).toBe(6000);
  });

  it('returns null on loss (no split, nobody paid or charged)', () => {
    expect(distributeTradingProfitShare(-5000)).toBeNull();
  });

  it('returns null on breakeven', () => {
    expect(distributeTradingProfitShare(0)).toBeNull();
  });

  it('reconciles to the cent for an arbitrary odd profit', () => {
    for (const profit of [1, 3, 7, 101, 999, 12345]) {
      const s = distributeTradingProfitShare(profit);
      expect(s).not.toBeNull();
      expect(s!.clientCents + s!.sponsorCents + s!.companyCents).toBe(profit);
    }
  });

  it('rejects a non-integer profit', () => {
    expect(() => distributeTradingProfitShare(10.5)).toThrow();
  });
});
