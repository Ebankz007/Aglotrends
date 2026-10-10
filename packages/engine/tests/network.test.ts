import { describe, expect, it } from 'vitest';
import {
  buildNetworkIndex,
  countPersonalReferrals,
  directReferrals,
  distinctLegsCovering,
  eligibleTeamVolume,
  getDownline,
  getUplineChain,
  isInSubtree,
  rawTeamVolume,
  type MemberNode,
} from '../src/index.js';

const node = (
  id: string,
  sponsorId: string | null,
  isActive = true,
  highestAssociateRank = 0,
): MemberNode => ({ id, sponsorId, isActive, highestAssociateRank, highestLeadershipRank: 0 });

describe('network index', () => {
  it('builds sponsor children and rejects a missing sponsor', () => {
    const index = buildNetworkIndex([node('root', null), node('a', 'root'), node('b', 'root')]);
    expect(directReferrals(index, 'root')).toEqual(['a', 'b']);
    expect(() => buildNetworkIndex([node('x', 'ghost')])).toThrow();
  });

  it('rejects duplicate ids', () => {
    expect(() => buildNetworkIndex([node('a', null), node('a', null)])).toThrow();
  });
});

describe('tree traversal', () => {
  const index = buildNetworkIndex([
    node('root', null),
    node('a', 'root'),
    node('b', 'root'),
    node('a1', 'a'),
    node('a2', 'a'),
    node('a1x', 'a1'),
  ]);

  it('returns the upline chain with self at index 0', () => {
    const chain = getUplineChain(index, 'a1x');
    expect(chain.map((n) => n.id)).toEqual(['a1x', 'a1', 'a', 'root']);
  });

  it('returns the downline (excluding self)', () => {
    expect(getDownline(index, 'a').sort()).toEqual(['a1', 'a1x', 'a2'].sort());
  });

  it('counts personal referrals', () => {
    expect(countPersonalReferrals(index, 'root')).toBe(2);
    expect(countPersonalReferrals(index, 'a')).toBe(2);
  });

  it('computes raw team volume as downline size', () => {
    expect(rawTeamVolume(index, 'root')).toBe(5);
    expect(rawTeamVolume(index, 'a')).toBe(3);
  });

  it('detects subtree membership', () => {
    expect(isInSubtree(index, 'a', 'a1x')).toBe(true);
    expect(isInSubtree(index, 'a', 'b')).toBe(false);
    expect(isInSubtree(index, 'a', 'a')).toBe(false);
  });
});

describe('§5 leg rule (40% cap on eligible team volume)', () => {
  it('keeps balanced legs intact', () => {
    const nodes: MemberNode[] = [node('M', null)];
    for (const leg of ['A', 'B', 'C']) {
      nodes.push(node(leg, 'M'));
      for (let i = 1; i <= 3; i += 1) nodes.push(node(`${leg}${i}`, leg));
    }
    const index = buildNetworkIndex(nodes);
    // 3 legs of 4 members = 12 total; cap = 4.8; each leg 4 <= 4.8
    expect(eligibleTeamVolume(index, 'M')).toBe(12);
  });

  it('truncates an over-weighted leg to 40% of total', () => {
    const nodes: MemberNode[] = [node('M', null)];
    // Leg A = 10 members, legs B and C = 1 each -> total 12, cap 4.8
    nodes.push(node('A', 'M'));
    for (let i = 1; i <= 9; i += 1) nodes.push(node(`A${i}`, 'A'));
    nodes.push(node('B', 'M'));
    nodes.push(node('C', 'M'));
    const index = buildNetworkIndex(nodes);
    expect(rawTeamVolume(index, 'M')).toBe(12);
    expect(eligibleTeamVolume(index, 'M')).toBeCloseTo(6.8, 5); // 4.8 + 1 + 1
  });
});

describe('§6 distinct legs covering', () => {
  it('counts how many direct legs contain the given members', () => {
    const index = buildNetworkIndex([
      node('M', null),
      node('A', 'M'),
      node('A1', 'A'),
      node('B', 'M'),
      node('B1', 'B'),
      node('C', 'M'),
    ]);
    expect(distinctLegsCovering(index, 'M', ['A1', 'B1'])).toBe(2);
    expect(distinctLegsCovering(index, 'M', ['A', 'A1'])).toBe(1);
    expect(distinctLegsCovering(index, 'M', ['A', 'B', 'C'])).toBe(3);
  });
});
