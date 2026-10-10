/**
 * Aglotrends Compensation Engine — Ranks (§5 Associate, §6 Leadership)
 *
 * Associate Ranks are evaluated bottom-up (highest first) with an AND condition
 * on personal referrals and eligible team volume, paid once on first
 * qualification. Leadership Ranks sit above them and require a self-qualification
 * gate plus a leg-spread rule.
 */
import { ASSOCIATE_RANKS, LEADERSHIP_RANKS } from './constants.js';
import {
  countPersonalReferrals,
  distinctLegsCovering,
  eligibleTeamVolume,
  getDownline,
} from './network.js';
import type {
  AssociateRankQualification,
  LeadershipRankQualification,
  NetworkIndex,
} from './types.js';

/**
 * §5 — evaluate the highest Associate Rank the member newly qualifies for
 * (strictly above their current highest). Returns null if none.
 */
export function evaluateAssociateRank(
  index: NetworkIndex,
  memberId: string,
): AssociateRankQualification | null {
  const member = index.byId.get(memberId);
  if (!member) return null;

  const personalReferrals = countPersonalReferrals(index, memberId);
  const teamVolume = eligibleTeamVolume(index, memberId);

  let qualifying: AssociateRankQualification | null = null;
  for (let i = ASSOCIATE_RANKS.length - 1; i >= 0; i -= 1) {
    const rank = ASSOCIATE_RANKS[i]!;
    if (personalReferrals >= rank.minPersonalReferrals && teamVolume >= rank.minTeamVolume) {
      qualifying = { rankId: rank.rankId, rewardCents: rank.rewardCents };
      break;
    }
  }

  if (qualifying && qualifying.rankId > member.highestAssociateRank) return qualifying;
  return null;
}

/**
 * §6 — evaluate the highest Leadership Rank the member newly qualifies for
 * (strictly above their current highest). Returns null if none.
 */
export function evaluateLeadershipRank(
  index: NetworkIndex,
  memberId: string,
): LeadershipRankQualification | null {
  const member = index.byId.get(memberId);
  if (!member) return null;

  const downline = getDownline(index, memberId);

  let qualifying: LeadershipRankQualification | null = null;
  for (let i = LEADERSHIP_RANKS.length - 1; i >= 0; i -= 1) {
    const rank = LEADERSHIP_RANKS[i]!;
    // Self-qualification gate.
    if (member.highestAssociateRank < rank.requiredAssociateRank) continue;

    const teamAtRank = downline.filter((id) => {
      const m = index.byId.get(id);
      return m !== undefined && m.highestAssociateRank >= rank.requiredAssociateRank;
    });
    const legsCovered = distinctLegsCovering(index, memberId, teamAtRank);

    if (teamAtRank.length >= rank.minTeamMembers && legsCovered >= rank.minLegs) {
      qualifying = { rankId: rank.rankId, name: rank.name, rewardSku: rank.rewardSku };
      break;
    }
  }

  if (qualifying && qualifying.rankId > member.highestLeadershipRank) return qualifying;
  return null;
}
