import { buildNetworkIndex, createMatrixTree, type MemberNode, type NetworkIndex } from '@aglotrends/engine';
import { schema } from '../db.js';
import type { DbLike, Tx } from '../db.js';
import type { MatrixTree } from '@aglotrends/engine';

/** Load every member as an engine MemberNode and build the sponsor-tree index. */
export async function loadNetworkIndex(db: DbLike): Promise<NetworkIndex> {
  const rows = await db
    .select({
      id: schema.users.id,
      sponsorId: schema.users.sponsorId,
      isActiveMember: schema.users.isActiveMember,
      highestAssociateRank: schema.users.highestAssociateRank,
      highestLeadershipRank: schema.users.highestLeadershipRank,
    })
    .from(schema.users);

  const nodes: MemberNode[] = rows.map((r) => ({
    id: r.id,
    sponsorId: r.sponsorId,
    isActive: r.isActiveMember,
    highestAssociateRank: r.highestAssociateRank,
    highestLeadershipRank: r.highestLeadershipRank,
  }));
  return buildNetworkIndex(nodes);
}

/** Load the matrix tree (matrixParentId relationships) into an engine MatrixTree. */
export async function loadMatrixTree(db: DbLike): Promise<MatrixTree> {
  const rows = await db
    .select({ id: schema.users.id, matrixParentId: schema.users.matrixParentId })
    .from(schema.users);

  const tree = createMatrixTree();
  for (const r of rows) tree.children.set(r.id, []);
  for (const r of rows) {
    if (r.matrixParentId) {
      const siblings = tree.children.get(r.matrixParentId);
      if (siblings) siblings.push(r.id);
      else tree.children.set(r.matrixParentId, [r.id]);
    }
  }
  return tree;
}

export type { Tx };
