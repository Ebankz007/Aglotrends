/**
 * Aglotrends Compensation Engine — Network Index (§5, §8, §9)
 *
 * Pure tree helpers over an immutable index built from a flat member list.
 * No database, no framework. Team volume is measured in downline MEMBER COUNT
 * (the source document does not specify units; this is the engine's assumption,
 * overridable at the call site by pre-computing volumes if needed).
 */
import { MAX_LEG_CONTRIBUTION_BPS } from './constants.js';
import type { MemberNode, NetworkIndex } from './types.js';

/** Build a sponsor-tree index from a flat list of member nodes. */
export function buildNetworkIndex(nodes: readonly MemberNode[]): NetworkIndex {
  const byId = new Map<string, MemberNode>();
  const children = new Map<string, string[]>();

  for (const node of nodes) {
    if (byId.has(node.id)) throw new Error(`buildNetworkIndex: duplicate member id ${node.id}`);
    byId.set(node.id, node);
    children.set(node.id, []);
  }

  for (const node of nodes) {
    if (node.sponsorId === null) continue;
    const siblings = children.get(node.sponsorId);
    if (!siblings) {
      throw new Error(`buildNetworkIndex: sponsor ${node.sponsorId} not found for member ${node.id}`);
    }
    siblings.push(node.id);
  }

  return { byId, children };
}

/** Direct referral (PEM) ids for a member, in insertion order. */
export function directReferrals(index: NetworkIndex, memberId: string): readonly string[] {
  return index.children.get(memberId) ?? [];
}

/**
 * Upline chain for a member: index 0 = the member, 1 = sponsor, 2 = gen 2, ...
 * Stops when the tree ends or `maxDepth` levels above the member are reached.
 */
export function getUplineChain(
  index: NetworkIndex,
  memberId: string,
  maxDepth = Number.POSITIVE_INFINITY,
): MemberNode[] {
  const chain: MemberNode[] = [];
  let current: MemberNode | undefined = index.byId.get(memberId);
  let depth = 0;
  while (current && depth <= maxDepth) {
    chain.push(current);
    if (current.sponsorId === null) break;
    current = index.byId.get(current.sponsorId);
    depth += 1;
  }
  return chain;
}

/** All descendants of a member (BFS), excluding the member. */
export function getDownline(index: NetworkIndex, memberId: string): string[] {
  const out: string[] = [];
  const queue = [...directReferrals(index, memberId)];
  while (queue.length) {
    const id = queue.shift()!;
    out.push(id);
    queue.push(...directReferrals(index, id));
  }
  return out;
}

/** Size of the subtree rooted at a member (descendant count). */
export function subtreeSize(index: NetworkIndex, memberId: string): number {
  return getDownline(index, memberId).length;
}

/** §5 — count of personal (direct) referrals. */
export function countPersonalReferrals(index: NetworkIndex, memberId: string): number {
  return directReferrals(index, memberId).length;
}

/** §5 — raw team volume = total downline member count. */
export function rawTeamVolume(index: NetworkIndex, memberId: string): number {
  return subtreeSize(index, memberId);
}

/**
 * §5 — team volume eligible for rank qualification, applying the Leg Rule:
 * no single referral leg may contribute more than 40% of total volume. Any leg
 * above the cap is truncated to the cap.
 */
export function eligibleTeamVolume(index: NetworkIndex, memberId: string): number {
  // A leg's volume includes the direct referral itself plus their downline.
  const legs = directReferrals(index, memberId).map((legId) => 1 + subtreeSize(index, legId));
  const total = legs.reduce((sum, v) => sum + v, 0);
  const cap = (total * MAX_LEG_CONTRIBUTION_BPS) / 10_000;
  return legs.reduce((sum, legVolume) => sum + Math.min(legVolume, cap), 0);
}

/** Is `candidateId` a descendant of `ancestorId`? */
export function isInSubtree(index: NetworkIndex, ancestorId: string, candidateId: string): boolean {
  let current = index.byId.get(candidateId);
  while (current && current.sponsorId !== null) {
    if (current.sponsorId === ancestorId) return true;
    current = index.byId.get(current.sponsorId);
  }
  return false;
}

/**
 * §6 — how many distinct direct legs of `memberId` contain at least one of the
 * given members. Used by the Leadership "leg spread" rule.
 */
export function distinctLegsCovering(
  index: NetworkIndex,
  memberId: string,
  memberIds: readonly string[],
): number {
  const legs = directReferrals(index, memberId);
  let covered = 0;
  for (const leg of legs) {
    // The leg root is itself part of the leg; descendants count too.
    if (memberIds.some((id) => id === leg || isInSubtree(index, leg, id))) covered += 1;
  }
  return covered;
}
