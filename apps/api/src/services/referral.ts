import { randomBytes } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import { db, schema } from '../db.js';
import { ApiError } from '../lib/errors.js';

/**
 * Referral codes — the member's public join handle (e.g. K7Q2M9XD), encoded in
 * referral links (/register?ref=CODE). Codes replace sponsor emails everywhere
 * a sponsor is named: registration, admin moves, and the portal display.
 *
 * The alphabet drops look-alikes (0/O, 1/I/L) so codes survive being read out
 * loud or retyped from a screenshot. Codes are minted once and never change.
 */

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const REFERRAL_CODE_LENGTH = 8;

export function generateReferralCode(): string {
  const bytes = randomBytes(REFERRAL_CODE_LENGTH);
  let out = '';
  for (const b of bytes) out += ALPHABET[(b as number) % ALPHABET.length];
  return out;
}

/** Canonical form for lookup: trimmed, uppercased. Codes are case-insensitive. */
export function normalizeReferralCode(raw: string): string {
  return raw.trim().toUpperCase();
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: unknown }).code === '23505'
  );
}

/**
 * Mint a fresh unique code and attach it to the member. The conditional update
 * (`referral_code IS NULL`) means a concurrent minter cannot overwrite an
 * existing code — the loser falls through to reading the winner's value.
 * Retries on the (unlikely) random collision.
 */
export async function mintReferralCode(userId: string): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const code = generateReferralCode();
    try {
      const [row] = await db
        .update(schema.users)
        .set({ referralCode: code, updatedAt: new Date() })
        .where(and(eq(schema.users.id, userId), isNull(schema.users.referralCode)))
        .returning({ referralCode: schema.users.referralCode });
      if (row?.referralCode) return row.referralCode;
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      continue;
    }
    // No row updated: someone else minted first (or the member is gone).
    const [current] = await db
      .select({ referralCode: schema.users.referralCode })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1);
    if (current?.referralCode) return current.referralCode;
    throw ApiError.notFound('Member not found');
  }
  throw new Error('mintReferralCode: too many collisions');
}

/** Return the member's code, minting one for rows predating the feature. */
export async function ensureReferralCode(userId: string): Promise<string | null> {
  const [row] = await db
    .select({ referralCode: schema.users.referralCode })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  if (!row) return null;
  if (row.referralCode) return row.referralCode;
  return mintReferralCode(userId);
}

/** Resolve a join code to its owner. Any role may sponsor (as with emails before). */
export async function resolveSponsorByCode(raw: string): Promise<{ id: string; role: string }> {
  const code = normalizeReferralCode(raw);
  const [sponsor] = await db
    .select({ id: schema.users.id, role: schema.users.role })
    .from(schema.users)
    .where(eq(schema.users.referralCode, code))
    .limit(1);
  if (!sponsor) {
    throw ApiError.badRequest(
      'Referral code not found — check the code or use your sponsor\u2019s link',
      'SPONSOR_NOT_FOUND',
    );
  }
  return { id: sponsor.id, role: sponsor.role as string };
}
