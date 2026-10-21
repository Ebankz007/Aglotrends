import { eq } from 'drizzle-orm';
import { db, schema } from '../db.js';
import { ApiError } from '../lib/errors.js';

export async function createUserSubscription(input: {
  userId: string;
  providerId: string;
  planId?: string;
  priceCents: number;
  currency?: string;
  interval: 'MONTHLY' | '6MONTH' | 'YEARLY';
  startsAt?: Date;
  paymentSource?: 'WALLET' | 'GATEWAY';
}) {
  const startsAt = input.startsAt ?? new Date();
  const expiresAt = new Date(startsAt);
  switch (input.interval) {
    case 'MONTHLY':
      expiresAt.setMonth(expiresAt.getMonth() + 1);
      break;
    case '6MONTH':
      expiresAt.setMonth(expiresAt.getMonth() + 6);
      break;
    case 'YEARLY':
      expiresAt.setFullYear(expiresAt.getFullYear() + 1);
      break;
  }

  if (input.paymentSource === 'WALLET') {
    const [wallet] = await db.select().from(schema.wallets).where(eq(schema.wallets.userId, input.userId));
    if (!wallet || wallet.balanceCents < input.priceCents) {
      throw ApiError.badRequest('Insufficient wallet balance');
    }
    await db.update(schema.wallets).set({ balanceCents: wallet.balanceCents - input.priceCents, updatedAt: new Date() }).where(eq(schema.wallets.id, wallet.id));
    await db.insert(schema.ledgerEntries).values({
      userId: input.userId,
      type: 'SUBSCRIPTION_PAYMENT',
      amountCents: -input.priceCents,
      balanceAfterCents: wallet.balanceCents - input.priceCents,
      description: `Subscription payment to provider ${input.providerId}`,
    });
  } else if (input.paymentSource === 'GATEWAY') {
    // Create a pending payment record for gateway processing
    await db.insert(schema.payments).values({
      userId: input.userId,
      amountCents: input.priceCents,
      currency: 'USDT',
      purpose: 'DEPOSIT',
      status: 'PENDING',
      paymentRef: `sub-${input.providerId}-${Date.now()}`,
    });
  }

  const [sub] = await db.insert(schema.userSubscriptions).values({
    userId: input.userId,
    providerId: input.providerId,
    planId: input.planId ?? null,
    priceCents: input.priceCents,
    currency: input.currency ?? 'USD',
    startsAt,
    expiresAt,
    status: 'ACTIVE',
  }).returning();

  if (!sub) throw new Error('createUserSubscription: insert failed');
  return sub;
}

export async function getActiveSubscriptionsForUser(userId: string) {
  const now = new Date();
  return await db.select().from(schema.userSubscriptions).where(
    eq(schema.userSubscriptions.userId, userId)
  );
}
