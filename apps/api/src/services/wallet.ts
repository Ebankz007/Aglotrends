import { eq } from 'drizzle-orm';
import { schema } from '../db.js';
import type { Tx } from '../db.js';
import { ApiError } from '../lib/errors.js';

export interface LedgerInput {
  userId: string;
  amountCents: number; // always positive; direction is decided by the helper
  type: string;
  sourceUserId?: string | null;
  refType?: string | null;
  refId?: string | null;
  description?: string | null;
}

async function applyDelta(
  tx: Tx,
  input: LedgerInput,
  signedAmountCents: number,
): Promise<number> {
  const [wallet] = await tx
    .select()
    .from(schema.wallets)
    .where(eq(schema.wallets.userId, input.userId));
  if (!wallet) throw ApiError.notFound(`Wallet not found for user ${input.userId}`);

  const balanceAfter = wallet.balanceCents + signedAmountCents;
  if (balanceAfter < 0) throw ApiError.conflict('Insufficient wallet balance', 'INSUFFICIENT_FUNDS');

  await tx.insert(schema.ledgerEntries).values({
    userId: input.userId,
    type: input.type,
    amountCents: signedAmountCents,
    balanceAfterCents: balanceAfter,
    sourceUserId: input.sourceUserId ?? null,
    refType: input.refType ?? null,
    refId: input.refId ?? null,
    description: input.description ?? null,
  });
  await tx
    .update(schema.wallets)
    .set({ balanceCents: balanceAfter, updatedAt: new Date() })
    .where(eq(schema.wallets.userId, input.userId));
  return balanceAfter;
}

/** Credit a wallet (positive amount). Returns the new balance. */
export async function creditWallet(tx: Tx, input: LedgerInput): Promise<number> {
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
    throw new Error(`creditWallet: amount must be a positive integer, got ${input.amountCents}`);
  }
  return applyDelta(tx, input, input.amountCents);
}

/** Debit a wallet (positive amount, stored negative). Returns the new balance. */
export async function debitWallet(tx: Tx, input: LedgerInput): Promise<number> {
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
    throw new Error(`debitWallet: amount must be a positive integer, got ${input.amountCents}`);
  }
  return applyDelta(tx, input, -input.amountCents);
}
