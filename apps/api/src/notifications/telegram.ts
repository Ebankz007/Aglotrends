import {
  resolveTelegramIntegration,
  type ResolvedTelegramIntegration,
} from '../services/settings.js';

export type { ResolvedTelegramIntegration };

/** Resolve the channel config from the console, falling back to the environment. */
export async function telegramConfig(): Promise<ResolvedTelegramIntegration> {
  return resolveTelegramIntegration();
}

/** False = the channel is off; the fan-out records SKIPPED, never FAILED. */
export function telegramConfigured(cfg: ResolvedTelegramIntegration): boolean {
  return cfg.enabled && cfg.botToken.trim().length > 0;
}

/** Telegram Bot API sendMessage. */
export async function sendTelegram(
  chatId: string,
  text: string,
  cfg: ResolvedTelegramIntegration,
): Promise<void> {
  if (!telegramConfigured(cfg)) throw new Error('telegram channel not configured');
  const res = await fetch(`https://api.telegram.org/bot${cfg.botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
  if (!res.ok) throw new Error(`Telegram send failed: ${res.status} ${await res.text()}`);
}
