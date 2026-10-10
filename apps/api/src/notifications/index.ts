import { eq } from 'drizzle-orm';
import { db, schema } from '../db.js';
import { logger } from '../logger.js';
import { emailConfigured, sendEmail } from './email.js';
import { sendTelegram, telegramConfigured } from './telegram.js';
import { sendWhatsApp, whatsappConfigured } from './whatsapp.js';

type Signal = typeof schema.signals.$inferSelect;
type Channel = 'IN_APP' | 'EMAIL' | 'WHATSAPP' | 'TELEGRAM';
type DeliveryStatus = 'PENDING' | 'SENT' | 'FAILED' | 'SKIPPED';

/** Human-readable signal body, used for every channel. */
export function formatSignal(s: Signal): string {
  return [
    `Aglotrends signal — ${s.title}`,
    `Instrument: ${s.instrument} (${s.direction})`,
    s.entryPrice ? `Entry: ${s.entryPrice}` : null,
    s.stopLoss ? `Stop loss: ${s.stopLoss}` : null,
    s.takeProfit ? `Take profit: ${s.takeProfit}` : null,
    s.timeframe ? `Timeframe: ${s.timeframe}` : null,
    s.notes ? `\n${s.notes}` : null,
  ]
    .filter((line): line is string => line !== null)
    .join('\n');
}

async function recordDelivery(
  signalId: string,
  userId: string | null,
  channel: Channel,
  status: DeliveryStatus,
  error?: string,
): Promise<void> {
  await db.insert(schema.signalDeliveries).values({
    signalId,
    userId,
    channel,
    status,
    error: error ?? null,
    sentAt: status === 'SENT' ? new Date() : null,
  });
}

/**
 * Fan a published signal out to every active member: an in-app notification plus
 * email / WhatsApp / Telegram per each member's preferences. A channel that is
 * not configured platform-wide is recorded SKIPPED, never FAILED.
 */
export async function dispatchSignalNotifications(signal: Signal): Promise<void> {
  const body = formatSignal(signal);
  const members = await db
    .select({ id: schema.users.id, email: schema.users.email })
    .from(schema.users)
    .where(eq(schema.users.status, 'ACTIVE'));

  for (const m of members) {
    await db.insert(schema.notifications).values({
      userId: m.id,
      type: 'SIGNAL',
      title: signal.title,
      body,
      link: `/signals/${signal.id}`,
    });
    await recordDelivery(signal.id, m.id, 'IN_APP', 'SENT');

    const [prefs] = await db
      .select()
      .from(schema.notificationSettings)
      .where(eq(schema.notificationSettings.userId, m.id));

    const attempts: Array<{ channel: Channel; enabled: boolean; run: () => Promise<unknown> }> = [
      {
        channel: 'EMAIL',
        enabled: emailConfigured() && (prefs?.emailEnabled ?? true),
        run: () => sendEmail(m.email, signal.title, body),
      },
      {
        channel: 'WHATSAPP',
        enabled: whatsappConfigured() && (prefs?.whatsappEnabled ?? false) && !!prefs?.whatsappNumber,
        run: () => sendWhatsApp(prefs!.whatsappNumber!, body),
      },
      {
        channel: 'TELEGRAM',
        enabled: telegramConfigured() && (prefs?.telegramEnabled ?? false) && !!prefs?.telegramChatId,
        run: () => sendTelegram(prefs!.telegramChatId!, body),
      },
    ];

    for (const a of attempts) {
      if (!a.enabled) {
        await recordDelivery(signal.id, m.id, a.channel, 'SKIPPED');
        continue;
      }
      try {
        await a.run();
        await recordDelivery(signal.id, m.id, a.channel, 'SENT');
      } catch (err) {
        logger.warn({ err, channel: a.channel, userId: m.id }, 'signal delivery failed');
        await recordDelivery(signal.id, m.id, a.channel, 'FAILED', String(err));
      }
    }
  }
}
