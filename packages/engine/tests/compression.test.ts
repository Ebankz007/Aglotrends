import { describe, expect, it } from 'vitest';
import { buildNetworkIndex, getNextQualifiedUpline, type MemberNode } from '../src/index.js';

const node = (id: string, sponsorId: string | null, isActive = true): MemberNode => ({
  id,
  sponsorId,
  isActive,
  highestAssociateRank: 0,
  highestLeadershipRank: 0,
});

describe('§9.2 compression rule', () => {
  it('returns the immediate sponsor when active', () => {
    const index = buildNetworkIndex([node('a', null), node('b', 'a')]);
    expect(getNextQualifiedUpline(index, 'b')?.id).toBe('a');
  });

  it('skips inactive positions upward', () => {
    const index = buildNetworkIndex([
      node('top', null, true),
      node('mid1', 'top', false),
      node('mid2', 'mid1', false),
      node('self', 'mid2', true),
    ]);
    expect(getNextQualifiedUpline(index, 'self')?.id).toBe('top');
  });

  it('returns null when no qualified upline exists within the window', () => {
    const index = buildNetworkIndex([
      node('top', null, false),
      node('self', 'top', true),
    ]);
    expect(getNextQualifiedUpline(index, 'self')).toBeNull();
  });

  it('stops after stopAtGen levels', () => {
    const index = buildNetworkIndex([
      node('far', null, true),
      node('x1', 'far', false),
      node('x2', 'x1', false),
      node('self', 'x2', true),
    ]);
    // window of 2: x2 (inactive), x1 (inactive) -> gives up before reaching far
    expect(getNextQualifiedUpline(index, 'self', 2)).toBeNull();
    // window of 3 reaches far
    expect(getNextQualifiedUpline(index, 'self', 3)?.id).toBe('far');
  });
});
