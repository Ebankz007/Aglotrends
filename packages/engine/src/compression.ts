/**
 * Aglotrends Compensation Engine — Compression Rule (§9.2)
 *
 * If the upline position that would normally receive a payout is NOT an Active
 * Member, that position is skipped ("compressed") and the payout passes to the
 * next qualified (Active) upline position within the compression window.
 */
import { COMPRESSION_STOP_AT_GEN } from './constants.js';
import type { MemberNode, NetworkIndex } from './types.js';

/**
 * Walk up from `fromMemberId`'s sponsor looking for the first Active member,
 * stopping after `stopAtGen` levels. Returns null if none is found (payout is
 * then not made).
 */
export function getNextQualifiedUpline(
  index: NetworkIndex,
  fromMemberId: string,
  stopAtGen: number = COMPRESSION_STOP_AT_GEN,
): MemberNode | null {
  const start = index.byId.get(fromMemberId);
  let current: MemberNode | undefined = start?.sponsorId ? index.byId.get(start.sponsorId) : undefined;
  let depth = 0;
  while (current && depth < stopAtGen) {
    if (current.isActive) return current;
    current = current.sponsorId ? index.byId.get(current.sponsorId) : undefined;
    depth += 1;
  }
  return null;
}
