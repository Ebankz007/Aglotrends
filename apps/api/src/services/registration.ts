import {
  CREDIT_TYPE,
  REGISTRATION_FEE_CENTS,
  allocateRegistrationFee,
  directReferralBonusCents,
  placeNewMember,
  resolveDirectReferralRecipient,
  resolveGenerationRecipients,
} from '@aglotrends/engine';
import { eq } from 'drizzle-orm';
import { db, schema } from '../db.js';
import { ApiError } from '../lib/errors.js';
import { accruePools } from './pools.js';
import { loadMatrixTree, loadNetworkIndex } from './network.js';
import { creditWallet } from './wallet.js';

export interface RegistrationResult {
  registrationId: string;
  matrixParentId: string | null;
  directReferralCents: number;
  generationCents: number;
  credits: number;
}

/**
 * Distribute a new member's registration fee: record it, accrue the pools,
 * pay the direct-referral and generation bonuses (§3/§4, with §9.2 compression),
 * place the member into the forced 3x3 matrix (§8), and activate them.
 *
 * This runs when the §1 fee is SETTLED — from the Pay2Crypto webhook, never from
 * the register route (see routes/auth.ts). A member who has not paid is
 * `isActiveMember = false`: not in the matrix, not earning.
 *
 * Idempotent: the `registrations` row is the token. The member row is locked
 * `FOR UPDATE` first, so two concurrent callers (e.g. two webhook retries)
 * serialise on one lock — the second sees the row the first committed and
 * distributes nothing. Safe to call from anywhere, any number of times.
 */
export async function processRegistration(newMemberId: string): Promise<RegistrationResult> {
  return db.transaction(async (tx) => {
    const [member] = await tx
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, newMemberId))
      .for('update');
    if (!member) throw ApiError.notFound('Member not found');

    const [existing] = await tx
      .select()
      .from(schema.registrations)
      .where(eq(schema.registrations.userId, newMemberId));
    if (existing) {
      // Already distributed. Report the original pool figures with zero new
      // credits — a replay must never pay out again.
      return {
        registrationId: existing.id,
        matrixParentId: member.matrixParentId,
        directReferralCents: existing.directReferralCents,
        generationCents: existing.generationCents,
        credits: 0,
      };
    }

    const fee = REGISTRATION_FEE_CENTS;
    const alloc = allocateRegistrationFee(fee);

    const [registration] = await tx
      .insert(schema.registrations)
      .values({
        userId: newMemberId,
        sponsorId: member.sponsorId,
        feeCents: fee,
        companyReserveCents: alloc.companyReserveCents,
        directReferralCents: alloc.directReferralPoolCents,
        generationCents: alloc.generationPoolCents,
        rankPoolCents: alloc.rankPoolContributionCents,
        leadershipPoolCents: alloc.leadershipPoolContributionCents,
      })
      .returning();
    if (!registration) throw new Error('processRegistration: failed to record registration');

    await accruePools(
      tx,
      alloc.rankPoolContributionCents,
      alloc.leadershipPoolContributionCents,
      registration.id,
    );

    const index = await loadNetworkIndex(tx);
    let credits = 0;

    // §3 — direct referral bonus (compresses if the sponsor is inactive).
    const directRecipient = resolveDirectReferralRecipient(index, newMemberId);
    if (directRecipient) {
      await creditWallet(tx, {
        userId: directRecipient.id,
        amountCents: directReferralBonusCents(fee),
        type: CREDIT_TYPE.directReferral,
        sourceUserId: newMemberId,
        refType: 'registration',
        refId: registration.id,
        description: 'Direct referral bonus',
      });
      credits += 1;
    }

    // §4 — generation bonuses 2..6 (each compresses independently).
    for (const c of resolveGenerationRecipients(index, newMemberId, fee)) {
      await creditWallet(tx, {
        userId: c.memberId,
        amountCents: c.amountCents,
        type: c.type,
        sourceUserId: newMemberId,
        refType: 'registration',
        refId: registration.id,
        description: 'Generation bonus',
      });
      credits += 1;
    }

    // §8 — forced 3x3 matrix placement (spillover). Root members have no sponsor.
    let matrixParentId: string | null = null;
    if (member.sponsorId) {
      const tree = await loadMatrixTree(tx);
      matrixParentId = placeNewMember(tree, newMemberId, member.sponsorId);
    }

    // The §1 fee is now settled, so the member becomes compensation-eligible and
    // takes their matrix seat. This is the ONLY place the system flips
    // `isActiveMember` on. An admin may override it afterwards, and a webhook
    // replay (the early return above) never reaches here — so an override sticks.
    await tx
      .update(schema.users)
      .set({ isActiveMember: true, matrixParentId, updatedAt: new Date() })
      .where(eq(schema.users.id, newMemberId));

    return {
      registrationId: registration.id,
      matrixParentId,
      directReferralCents: alloc.directReferralPoolCents,
      generationCents: alloc.generationPoolCents,
      credits,
    };
  });
}
