import { eq } from 'drizzle-orm';
import { db, schema } from '../db.js';
import { ApiError } from '../lib/errors.js';

export interface CreatePlanInput {
  providerId: string;
  name: string;
  interval: 'MONTHLY' | '6MONTH' | 'YEARLY';
  priceCents: number;
  currency?: string;
  isActive?: boolean;
}

export async function listSubscriptionPlans() {
  return await db.select().from(schema.subscriptionPlans).orderBy(schema.subscriptionPlans.createdAt);
}

export async function createSubscriptionPlan(input: CreatePlanInput) {
  const [plan] = await db.insert(schema.subscriptionPlans).values({
    providerId: input.providerId,
    name: input.name,
    interval: input.interval,
    priceCents: input.priceCents,
    currency: input.currency ?? 'USD',
    isActive: input.isActive ?? true,
  }).returning();
  if (!plan) throw new Error('createSubscriptionPlan: insert failed');
  return plan;
}

export async function updateSubscriptionPlan(id: string, input: Partial<CreatePlanInput>) {
  const [plan] = await db.update(schema.subscriptionPlans).set({
    providerId: input.providerId,
    name: input.name,
    interval: input.interval,
    priceCents: input.priceCents,
    currency: input.currency,
    isActive: input.isActive,
    updatedAt: new Date(),
  }).where(eq(schema.subscriptionPlans.id, id)).returning();
  if (!plan) throw ApiError.notFound('Plan not found');
  return plan;
}
