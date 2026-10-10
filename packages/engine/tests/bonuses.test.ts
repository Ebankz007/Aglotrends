import { describe, expect, it } from 'vitest';
import {
  buildNetworkIndex,
  directReferralBonusCents,
  generationBonusBreakdown,
  generationBonusCents,
  resolveDirectReferralRecipient,
  resolveGenerationRecipients,
  type MemberNode,
} from '../src/index.js';

const node = (
  id: string,
  sponsorId: string | null,
  isActive = true,
  highestAssociateRank = 0,
): MemberNode => ({ id, sponsorId, isActive, highestAssociateRank, highestLeadershipRank: 0 });

describe('§3 direct referral bonus', () => {
  it('amounts to $6.00 on the default fee', () => {
    expect(directReferralBonusCents()).toBe(600);
  });

  it('pays the direct sponsor', () => {
    const index = buildNetworkIndex([node('root', null), node('a', 'root')]);
    const recipient = resolveDirectReferralRecipient(index, 'a');
    expect(recipient?.id).toBe('root');
  });

  it('compresses to the next active upline when the sponsor is inactive', () => {
    const index = buildNetworkIndex([
      node('grand', null, true),
      node('mid', 'grand', false), // inactive sponsor
      node('newbie', 'mid', true),
    ]);
    const recipient = resolveDirectReferralRecipient(index, 'newbie');
    expect(recipient?.id).toBe('grand');
  });

  it('returns null when there is no upline', () => {
    const index = buildNetworkIndex([node('root', null)]);
    expect(resolveDirectReferralRecipient(index, 'root')).toBeNull();
  });
});

describe('§4 generation bonus amounts', () => {
  it('matches the documented per-generation amounts on $20', () => {
    expect(generationBonusCents(2)).toBe(80);
    expect(generationBonusCents(3)).toBe(40);
    expect(generationBonusCents(4)).toBe(30);
    expect(generationBonusCents(5)).toBe(30);
    expect(generationBonusCents(6)).toBe(20);
  });

  it('the breakdown totals the generation pool ($2.00)', () => {
    const total = generationBonusBreakdown().reduce((sum, g) => sum + g.amountCents, 0);
    expect(total).toBe(200);
  });

  it('rejects out-of-range generations', () => {
    expect(() => generationBonusCents(1)).toThrow();
    expect(() => generationBonusCents(7)).toThrow();
  });
});

describe('§4 generation recipient resolution', () => {
  it('credits generations 2..6 up the chain', () => {
    // chain: g1 <- g2 <- g3 <- g4 <- g5 <- g6 <- newbie
    const nodes: MemberNode[] = [];
    let sponsor: string | null = null;
    for (let i = 1; i <= 6; i += 1) {
      const id = `g${i}`;
      nodes.push(node(id, sponsor));
      sponsor = id;
    }
    nodes.push(node('newbie', 'g6'));
    const index = buildNetworkIndex(nodes);

    const credits = resolveGenerationRecipients(index, 'newbie');
    expect(credits.map((c) => c.memberId)).toEqual(['g5', 'g4', 'g3', 'g2', 'g1']);
    expect(credits.map((c) => c.amountCents)).toEqual([80, 40, 30, 30, 20]);
    expect(credits[0]!.type).toBe('GENERATION_BONUS_GEN2');
  });

  it('compresses past an inactive generation position', () => {
    const index = buildNetworkIndex([
      node('top', null, true),
      node('g2pos', 'top', false), // inactive
      node('g1pos', 'g2pos', true), // direct sponsor of newbie
      node('newbie', 'g1pos', true),
    ]);
    const credits = resolveGenerationRecipients(index, 'newbie');
    // gen 2 position inactive -> compresses to top; gen 3 position IS top.
    // Each generation is evaluated independently, so top receives both.
    expect(credits.map((c) => c.memberId)).toEqual(['top', 'top']);
    expect(credits.map((c) => c.type)).toEqual([
      'GENERATION_BONUS_GEN2',
      'GENERATION_BONUS_GEN3',
    ]);
  });
});
