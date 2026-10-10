import { Router } from 'express';
import {
  ASSOCIATE_RANKS,
  LEADERSHIP_RANKS,
  countPersonalReferrals,
  directReferrals,
  eligibleTeamVolume,
  getDownline,
  rawTeamVolume,
} from '@aglotrends/engine';
import { db } from '../db.js';
import { asyncHandler } from '../lib/async.js';
import { ApiError } from '../lib/errors.js';
import { requireAuth } from '../lib/auth.js';
import { loadMatrixTree, loadNetworkIndex } from '../services/network.js';

export const networkRouter = Router();
networkRouter.use(requireAuth);

networkRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const index = await loadNetworkIndex(db);
    const me = index.byId.get(req.user!.id);
    if (!me) throw ApiError.notFound('Member not found');

    res.json({
      personalReferrals: countPersonalReferrals(index, me.id),
      rawTeamVolume: rawTeamVolume(index, me.id),
      eligibleTeamVolume: eligibleTeamVolume(index, me.id),
      directReferrals: directReferrals(index, me.id),
      downlineCount: getDownline(index, me.id).length,
      highestAssociateRank: me.highestAssociateRank,
      highestLeadershipRank: me.highestLeadershipRank,
    });
  }),
);

networkRouter.get(
  '/downline',
  asyncHandler(async (req, res) => {
    const index = await loadNetworkIndex(db);
    const me = index.byId.get(req.user!.id);
    if (!me) throw ApiError.notFound('Member not found');
    const ids = getDownline(index, me.id);
    res.json({ members: ids.map((id) => ({ id })) });
  }),
);

networkRouter.get(
  '/matrix',
  asyncHandler(async (req, res) => {
    const tree = await loadMatrixTree(db);
    const children = tree.children.get(req.user!.id) ?? [];
    res.json({ position: req.user!.id, children });
  }),
);

networkRouter.get(
  '/ranks',
  asyncHandler(async (req, res) => {
    const index = await loadNetworkIndex(db);
    const me = index.byId.get(req.user!.id);
    if (!me) throw ApiError.notFound('Member not found');

    const personalReferrals = countPersonalReferrals(index, me.id);
    const teamVolume = eligibleTeamVolume(index, me.id);

    const nextAssociate = ASSOCIATE_RANKS.find((r) => r.rankId > me.highestAssociateRank) ?? null;
    const nextLeadership = LEADERSHIP_RANKS.find((r) => r.rankId > me.highestLeadershipRank) ?? null;

    res.json({
      personalReferrals,
      eligibleTeamVolume: teamVolume,
      highestAssociateRank: me.highestAssociateRank,
      highestLeadershipRank: me.highestLeadershipRank,
      nextAssociate: nextAssociate
        ? {
            rankId: nextAssociate.rankId,
            minPersonalReferrals: nextAssociate.minPersonalReferrals,
            minTeamVolume: nextAssociate.minTeamVolume,
            rewardCents: nextAssociate.rewardCents,
            referralsMet: personalReferrals >= nextAssociate.minPersonalReferrals,
            volumeMet: teamVolume >= nextAssociate.minTeamVolume,
          }
        : null,
      nextLeadership: nextLeadership
        ? {
            rankId: nextLeadership.rankId,
            name: nextLeadership.name,
            requiredAssociateRank: nextLeadership.requiredAssociateRank,
            minLegs: nextLeadership.minLegs,
            minTeamMembers: nextLeadership.minTeamMembers,
            rewardSku: nextLeadership.rewardSku,
          }
        : null,
    });
  }),
);
