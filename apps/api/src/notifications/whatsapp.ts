import { config } from '../config.js';

export function whatsappConfigured(): boolean {
  return config.WHATSAPP_TOKEN.trim().length > 0 && config.WHATSAPP_PHONE_ID.trim().length > 0;
}

/** WhatsApp Cloud API text message. */
export async function sendWhatsApp(to: string, text: string): Promise<void> {
  if (!whatsappConfigured()) throw new Error('whatsapp channel not configured');
  const res = await fetch(
    `https://graph.facebook.com/v21.0/${config.WHATSAPP_PHONE_ID}/messages`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.WHATSAPP_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { body: text },
      }),
    },
  );
  if (!res.ok) throw new Error(`WhatsApp send failed: ${res.status} ${await res.text()}`);
}
