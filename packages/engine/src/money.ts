/**
 * Aglotrends Compensation Engine — Money math.
 *
 * All money is integer cents. Percentages are integer basis points.
 * `splitByBps` uses largest-remainder rounding so buckets ALWAYS sum exactly to
 * the source amount, with no bucket more than 1 cent off its exact share.
 */

/** Apply a basis-point weight to an integer cent amount (floor). */
export function bpsOf(amountCents: number, weightBps: number): number {
  return Math.floor((amountCents * weightBps) / 10_000);
}

/**
 * Split `totalCents` across weighted buckets (weights in bps, summing to the
 * total weight) using largest-remainder rounding. Returns integer cents summing
 * EXACTLY to `totalCents`.
 */
export function splitByBps(totalCents: number, weightsBps: readonly number[]): number[] {
  if (!Number.isInteger(totalCents)) {
    throw new Error(`splitByBps: totalCents must be an integer, got ${totalCents}`);
  }
  const weightSum = weightsBps.reduce((sum, w) => sum + w, 0);
  if (weightSum <= 0) throw new Error('splitByBps: weights must sum to a positive value');

  const exact = weightsBps.map((w) => (totalCents * w) / weightSum);
  const base = exact.map(Math.floor);

  let remainder = totalCents - base.reduce((sum, v) => sum + v, 0);
  const order = exact
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac);

  for (const { i } of order) {
    if (remainder <= 0) break;
    base[i] = (base[i] ?? 0) + 1;
    remainder -= 1;
  }
  return base;
}

/** Integer cents -> USD number (display only; never feed back into math). */
export function centsToUsd(cents: number): number {
  return cents / 100;
}

/** USD number -> integer cents, rejecting sub-cent precision. */
export function usdToCents(usd: number): number {
  const cents = Math.round(usd * 100);
  if (Math.abs(usd * 100 - cents) > 1e-6) {
    throw new Error(`usdToCents: ${usd} is not representable in whole cents`);
  }
  return cents;
}
