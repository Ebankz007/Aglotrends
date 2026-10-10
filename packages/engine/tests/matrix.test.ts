import { describe, expect, it } from 'vitest';
import {
  createMatrixTree,
  findPlacementSlot,
  matrixChildren,
  placeNewMember,
} from '../src/index.js';

describe('§8 matrix placement & spillover', () => {
  it('places the first three directly under the sponsor', () => {
    const tree = createMatrixTree();
    expect(placeNewMember(tree, 'a', 'sponsor')).toBe('sponsor');
    expect(placeNewMember(tree, 'b', 'sponsor')).toBe('sponsor');
    expect(placeNewMember(tree, 'c', 'sponsor')).toBe('sponsor');
    expect([...matrixChildren(tree, 'sponsor')]).toEqual(['a', 'b', 'c']);
  });

  it('spills over to the first open position when the direct row is full', () => {
    const tree = createMatrixTree();
    placeNewMember(tree, 'a', 'sponsor');
    placeNewMember(tree, 'b', 'sponsor');
    placeNewMember(tree, 'c', 'sponsor');
    const slot = placeNewMember(tree, 'd', 'sponsor');
    expect(slot).toBe('a'); // first direct child, all legs empty -> tie broken by order
    expect([...matrixChildren(tree, 'a')]).toEqual(['d']);
  });

  it('fills the least-populated leg first', () => {
    const tree = createMatrixTree();
    placeNewMember(tree, 'a', 'sponsor');
    placeNewMember(tree, 'b', 'sponsor');
    placeNewMember(tree, 'c', 'sponsor');
    // fill leg A with 3 children
    placeNewMember(tree, 'a1', 'a');
    placeNewMember(tree, 'a2', 'a');
    placeNewMember(tree, 'a3', 'a');
    // now legs B and C are empty -> next placement should go to B
    const slot = placeNewMember(tree, 'b1', 'sponsor');
    expect(slot).toBe('b');
  });

  it('does not exceed MATRIX_WIDTH=3 direct placements at any position', () => {
    const tree = createMatrixTree();
    const members = Array.from({ length: 40 }, (_, i) => `m${i}`);
    for (const m of members) placeNewMember(tree, m, 'sponsor');
    for (const [, kids] of tree.children) {
      expect(kids.length).toBeLessThanOrEqual(3);
    }
  });

  it('findPlacementSlot is pure (does not mutate)', () => {
    const tree = createMatrixTree();
    placeNewMember(tree, 'a', 'sponsor');
    placeNewMember(tree, 'b', 'sponsor');
    placeNewMember(tree, 'c', 'sponsor');
    const before = JSON.stringify([...tree.children.entries()]);
    findPlacementSlot(tree, 'sponsor');
    const after = JSON.stringify([...tree.children.entries()]);
    expect(after).toBe(before);
  });
});
