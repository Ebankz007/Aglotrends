import { eq } from 'drizzle-orm';
import { db, schema } from '../db.js';
import { ApiError } from '../lib/errors.js';
import { dispatchSignalNotifications } from '../notifications/index.js';

export interface CreateSignalInput {
  authorId: string;
  title: string;
  instrument: string;
  direction: 'BUY' | 'SELL' | 'NEUTRAL';
  entryPrice?: string;
  stopLoss?: string;
  takeProfit?: string;
  timeframe?: string;
  notes?: string;
  visibility?: 'FREE' | 'PREMIUM';
  chartImageUrl?: string;
  chartLink?: string;
  publish?: boolean;
}

export async function createSignal(input: CreateSignalInput) {
  const [signal] = await db
    .insert(schema.signals)
    .values({
      authorId: input.authorId,
      title: input.title,
      instrument: input.instrument,
      direction: input.direction,
      entryPrice: input.entryPrice ?? null,
      stopLoss: input.stopLoss ?? null,
      takeProfit: input.takeProfit ?? null,
      timeframe: input.timeframe ?? null,
      notes: input.notes ?? null,
      visibility: input.visibility ?? 'FREE',
      chartImageUrl: input.chartImageUrl ?? null,
      chartLink: input.chartLink ?? null,
      status: input.publish ? 'PUBLISHED' : 'DRAFT',
      publishedAt: input.publish ? new Date() : null,
    })
    .returning();
  if (!signal) throw new Error('createSignal: insert failed');
  if (input.publish) await dispatchSignalNotifications(signal);
  return signal;
}

export async function publishSignal(signalId: string) {
  const [signal] = await db
    .update(schema.signals)
    .set({ status: 'PUBLISHED', publishedAt: new Date(), updatedAt: new Date() })
    .where(eq(schema.signals.id, signalId))
    .returning();
  if (!signal) throw ApiError.notFound('Signal not found');
  await dispatchSignalNotifications(signal);
  return signal;
}
