import { config } from '../config.js';

export function telegramConfigured(): boolean {
  return config.TELEGRAM_BOT_TOKEN.trim().length > 0;
}

/** Telegram Bot API sendMessage. */
export async function sendTelegram(chatId: string, text: string): Promise<void> {
  if (!telegramConfigured()) throw new Error('telegram channel not configured');
  const res = await fetch(
    `https://api.telegram.org/bot${config.TELEGRAM_BOT_TOKEN}/sendMessage`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }),
    },
  );
  if (!res.ok) throw new Error(`Telegram send failed: ${res.status} ${await res.text()}`);
}
