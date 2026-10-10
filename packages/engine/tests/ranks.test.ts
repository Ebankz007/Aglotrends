import { describe, expect, it } from 'vitest';
import {
  buildNetworkIndex,
  evaluateAssociateRank,
  evaluateLeadershipRank,
  type MemberNode,
} from '../src/index.js';

const node = (
  id: string,
  sponsorId: string | null,
  highestAssociateRank = 0,
  isActive = true,
): MemberNode => ({ id, sponsorId, isActive, highestAssociateRank, highestLeadershipRank: 0 });

/** M with 3 balanced legs of 4 members each -> 3 refs, team volume 12. */
function balancedRankOneTree() {
  const nodes: MemberNode[] = [node('M', null)];
  for (const leg of ['A', 'B', 'C']) {
    nodes.push(node(leg, 'M'));
    for (let i = 1; i <= 3; i += 1) nodes.push(node(`${leg}${i}`, leg));
  }
  return buildNetworkIndex(nodes);
}

describe('§5 associate ranks', () => {
  it('awards Rank 1 on 3 refs + 12 team volume', () => {
    const index = balancedRankOneTree();
    const q = evaluateAssociateRank(index, 'M');
    expect(q).toEqual({ rankId: 1, rewardCents: 1400 });
  });

  it('returns null when the member already holds that rank', () => {
    const index = buildNetworkIndex(
      [node('M', null, 1), ...balancedRankOneTreeMembers()],
    );
    expect(evaluateAssociateRank(index, 'M')).toBeNull();
  });

  it('enforces the leg rule (a single dominant leg blocks qualification)', () => {
    const nodes: MemberNode[] = [node('M', null)];
    nodes.push(node('A', 'M'));
    for (let i = 1; i <= 9; i += 1) nodes.push(node(`A${i}`, 'A')); // leg A = 10
    nodes.push(node('B', 'M'));
    nodes.push(node('C', 'M'));
    const index = buildNetworkIndex(nodes);
    // eligible volume ~6.8 < 12 -> no rank
    expect(evaluateAssociateRank(index, 'M')).toBeNull();
  });

  it('requires BOTH conditions (refs alone are not enough)', () => {
    const nodes: MemberNode[] = [node('M', null)];
    for (const leg of ['A', 'B', 'C', 'D', 'E', 'F', 'G']) nodes.push(node(leg, 'M'));
    const index = buildNetworkIndex(nodes);
    // 7 refs but team volume only 7 (< 12) -> Rank 1 needs 12 -> null
    expect(evaluateAssociateRank(index, 'M')).toBeNull();
  });
});

function balancedRankOneTreeMembers(): MemberNode[] {
  const nodes: MemberNode[] = [];
  for (const leg of ['A', 'B', 'C']) {
    nodes.push(node(leg, 'M'));
    for (let i = 1; i <= 3; i += 1) nodes.push(node(`${leg}${i}`, leg));
  }
  return nodes;
}

describe('§6 leadership ranks', () => {
  it('awards Bronze Leader on 2 legs x ranked members', () => {
    const index = buildNetworkIndex([
      node('M', null, 3),
      node('A', 'M', 3),
      node('A1', 'A', 3),
      node('B', 'M', 3),
      node('B1', 'B', 3),
    ]);
    const q = evaluateLeadershipRank(index, 'M');
    expect(q).toEqual({ rankId: 1, name: 'Bronze Leader', rewardSku: 'SMARTPHONE' });
  });

  it('enforces the self-qualification gate', () => {
    const index = buildNetworkIndex([
      node('M', null, 2), // holds only Rank 2, Bronze needs Rank 3
      node('A', 'M', 3),
      node('B', 'M', 3),
      node('C', 'M', 3),
    ]);
    expect(evaluateLeadershipRank(index, 'M')).toBeNull();
  });

  it('enforces the leg-spread rule (all ranked members in one leg fails)', () => {
    const index = buildNetworkIndex([
      node('M', null, 3),
      node('A', 'M', 3),
      node('A1', 'A', 3),
      node('A2', 'A', 3),
      node('A3', 'A', 3),
    ]);
    expect(evaluateLeadershipRank(index, 'M')).toBeNull();
  });

  it('returns null when the member already holds that rank', () => {
    const index = buildNetworkIndex([
      { ...node('M', null, 3), highestLeadershipRank: 1 },
      node('A', 'M', 3),
      node('A1', 'A', 3),
      node('B', 'M', 3),
      node('B1', 'B', 3),
    ]);
    expect(evaluateLeadershipRank(index, 'M')).toBeNull();
  });
});
