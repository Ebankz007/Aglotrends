/**
 * Aglotrends Compensation Engine — Matrix Placement & Spillover (§8)
 *
 * New Personally Enrolled Members (PEMs) are placed into a forced 3x3 matrix
 * beneath their sponsor. When a position's direct row is full, the new member
 * spills over to the next open position within the sponsor's downline, filling
 * the least-populated leg first (balanced structure).
 */
import { MATRIX_DEPTH, MATRIX_WIDTH } from './constants.js';

/** A mutable matrix tree: parent position id -> ordered list of child ids. */
export interface MatrixTree {
  readonly children: Map<string, string[]>;
}

export function createMatrixTree(): MatrixTree {
  return { children: new Map() };
}

/** Ensure a position exists in the tree. */
export function ensurePosition(tree: MatrixTree, id: string): void {
  if (!tree.children.has(id)) tree.children.set(id, []);
}

export function matrixChildren(tree: MatrixTree, id: string): readonly string[] {
  return tree.children.get(id) ?? [];
}

/** Count of members in the subtree rooted at `id` (descendant count). */
function matrixSubtreeSize(tree: MatrixTree, id: string): number {
  let count = 0;
  const queue = [...matrixChildren(tree, id)];
  while (queue.length) {
    const next = queue.shift()!;
    count += 1;
    queue.push(...matrixChildren(tree, next));
  }
  return count;
}

/**
 * Find the position id under which a new member should be placed for `sponsorId`.
 * - If the sponsor's direct row has space (< MATRIX_WIDTH), place directly.
 * - Otherwise spill over, breadth-first, within MATRIX_DEPTH levels, choosing the
 *   open position in the least-populated leg.
 * - If fully saturated to depth, fall back to the least-populated direct leg.
 */
export function findPlacementSlot(
  tree: MatrixTree,
  sponsorId: string,
  maxDepth: number = MATRIX_DEPTH,
): string {
  ensurePosition(tree, sponsorId);
  const direct = matrixChildren(tree, sponsorId);
  if (direct.length < MATRIX_WIDTH) return sponsorId;

  let level: Array<{ id: string; legRoot: string }> = direct.map((id) => ({ id, legRoot: id }));
  let depth = 1;

  while (level.length && depth <= maxDepth) {
    const open = level.filter((n) => matrixChildren(tree, n.id).length < MATRIX_WIDTH);
    if (open.length) {
      open.sort((a, b) => matrixSubtreeSize(tree, a.legRoot) - matrixSubtreeSize(tree, b.legRoot));
      return open[0]!.id;
    }
    const next: Array<{ id: string; legRoot: string }> = [];
    for (const n of level) {
      for (const child of matrixChildren(tree, n.id)) {
        next.push({ id: child, legRoot: n.legRoot });
      }
    }
    level = next;
    depth += 1;
  }

  // Fully saturated within maxDepth: balance across direct legs.
  const sortedDirect = [...direct].sort(
    (a, b) => matrixSubtreeSize(tree, a) - matrixSubtreeSize(tree, b),
  );
  return sortedDirect[0]!;
}

/**
 * Place a new member into the matrix under `sponsorId`. Returns the id of the
 * position they were attached beneath (their matrix parent, which may differ
 * from their sponsor under spillover). Mutates the tree.
 */
export function placeNewMember(tree: MatrixTree, newMemberId: string, sponsorId: string): string {
  ensurePosition(tree, newMemberId);
  const slot = findPlacementSlot(tree, sponsorId);
  ensurePosition(tree, slot);
  tree.children.get(slot)!.push(newMemberId);
  return slot;
}
