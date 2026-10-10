/**
 * Aglotrends Compensation Engine — Bonuses (§3 Direct Referral, §4 Generation)
 *
 * Pure amount math plus recipient resolution over the network index. Recipient
 * resolution honours the §9.2 Compression Rule.
 */
import {
  COMMUNITY_POOL_SPLIT_BPS,
  CREDIT_TYPE,
  GENERATION_MAX,
  GENERATION_MIN,
  GENERATION_RATE_BPS,
  REGISTRATION_FEE_CENTS,
} from './constants.js';
import { bpsOf } from './money.js';
import { getNextQualifiedUpline } from './compression.js';
import { getUplineChain } from './network.js';
import type { MemberNode, NetworkIndex, WalletCredit } from './types.js';

/** §3 — direct referral bonus amount: fee x 30%. Default $6.00. */
export function directReferralBonusCents(feeCents: number = REGISTRATION_FEE_CENTS): number {
  return bpsOf(feeCents, COMMUNITY_POOL_SPLIT_BPS.directReferral);
}

/** §4 — generation bonus amount for one generation (2..6). */
export function generationBonusCents(
  generation: number,
  feeCents: number = REGISTRATION_FEE_CENTS,
): number {
  if (generation < GENERATION_MIN || generation > GENERATION_MAX) {
    throw new Error(`generationBonusCents: generation must be ${GENERATION_MIN}..${GENERATION_MAX}, got ${generation}`);
  }
  const rate = GENERATION_RATE_BPS[generation as keyof typeof GENERATION_RATE_BPS];
  return bpsOf(feeCents, rate);
}

/** §4 — full generation breakdown (one entry per generation 2..6). */
export function generationBonusBreakdown(
  feeCents: number = REGISTRATION_FEE_CENTS,
): Array<{ generation: number; amountCents: number }> {
  const out: Array<{ generation: number; amountCents: number }> = [];
  for (let gen = GENERATION_MIN; gen <= GENERATION_MAX; gen += 1) {
    out.push({ generation: gen, amountCents: generationBonusCents(gen, feeCents) });
  }
  return out;
}

/**
 * §3 — resolve who receives the direct referral bonus for a new registration:
 * the direct sponsor, or (if inactive) the next qualified upline. Null if no
 * sponsor / no qualified upline.
 */
export function resolveDirectReferralRecipient(
  index: NetworkIndex,
  newMemberId: string,
): MemberNode | null {
  const self = index.byId.get(newMemberId);
  if (!self || self.sponsorId === null) return null;
  const sponsor = index.byId.get(self.sponsorId);
  if (!sponsor) return null;
  if (sponsor.isActive) return sponsor;
  return getNextQualifiedUpline(index, sponsor.id);
}

/**
 * §4 — resolve generation bonus credits for a new registration. Evaluates each
 * generation 2..6 independently up the tree; inactive positions compress upward.
 */
export function resolveGenerationRecipients(
  index: NetworkIndex,
  newMemberId: string,
  feeCents: number = REGISTRATION_FEE_CENTS,
): WalletCredit[] {
  const chain = getUplineChain(index, newMemberId, GENERATION_MAX);
  const credits: WalletCredit[] = [];

  for (let gen = GENERATION_MIN; gen <= GENERATION_MAX; gen += 1) {
    const position = chain[gen];
    if (!position) continue; // tree not deep enough yet

    let recipient: MemberNode | null = position;
    if (!recipient.isActive) {
      recipient = getNextQualifiedUpline(index, position.id);
    }
    if (recipient) {
      credits.push({
        memberId: recipient.id,
        amountCents: generationBonusCents(gen, feeCents),
        type: CREDIT_TYPE.generation(gen),
        sourceMemberId: newMemberId,
      });
    }
  }

  return credits;
}
