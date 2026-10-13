import {
  resolveWhatsAppIntegration,
  type ResolvedWhatsAppIntegration,
} from '../services/settings.js';

export type { ResolvedWhatsAppIntegration };

/**
 * Resolve the channel config from the console, falling back to the environment.
 *
 * The fan-out resolves this ONCE per run and passes it down, rather than each
 * recipient re-reading `app_config` — a signal to 10k members must not be 10k
 * settings reads.
 */
export async function whatsappConfig(): Promise<ResolvedWhatsAppIntegration> {
  return resolveWhatsAppIntegration();
}

/** False = the channel is off; the fan-out records SKIPPED, never FAILED. */
export function whatsappConfigured(cfg: ResolvedWhatsAppIntegration): boolean {
  return cfg.enabled && cfg.token.trim().length > 0 && cfg.phoneId.trim().length > 0;
}

/** WhatsApp Cloud API text message. */
export async function sendWhatsApp(
  to: string,
  text: string,
  cfg: ResolvedWhatsAppIntegration,
): Promise<void> {
  if (!whatsappConfigured(cfg)) throw new Error('whatsapp channel not configured');
  const res = await fetch(`https://graph.facebook.com/v21.0/${cfg.phoneId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body: text },
    }),
  });
  if (!res.ok) throw new Error(`WhatsApp send failed: ${res.status} ${await res.text()}`);
}
