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
