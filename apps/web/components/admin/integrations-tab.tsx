"use client";

import { useEffect, useState } from "react";
import { ActionButton, Badge, Empty, Field, Note, Panel, Toggle } from "@/components/portal-ui";
import { useAsync } from "@/lib/hooks";
import {
  ApiError,
  fetchGatewayWebhook,
  fetchIntegrations,
  saveIntegrations,
  sendTestEmail,
  type GatewaySettingsDto,
  type GatewayWebhookDto,
  type IntegrationsDto,
  type SecretSource,
} from "@/lib/api";

const inputClass =
  "w-full rounded-2xl border border-white/10 bg-night-2 px-4 py-3 text-[15px] text-soft outline-none transition focus:border-brand/50";

function sourceLabel(source: SecretSource): string {
  return source === "database" ? "set in console" : source === "environment" ? "from .env" : "not set";
}

/**
 * A write-only secret input. The API never returns the value, so the field shows
 * only whether one is set and where it came from; typing replaces it, and the
 * checkbox clears it so the environment fallback resumes.
 */
function SecretField({
  label,
  hint,
  hasValue,
  source,
  value,
  onChange,
  clearing,
  onClearingChange,
}: {
  label: string;
  hint?: string;
  hasValue: boolean;
  source: SecretSource;
  value: string;
  onChange: (v: string) => void;
  clearing: boolean;
  onClearingChange: (v: boolean) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-[0.12em] text-mist">
        {label} — {sourceLabel(source)}
      </span>
      <input
        type="password"
        className={inputClass}
        value={value}
        disabled={clearing}
        autoComplete="new-password"
        placeholder={hasValue ? "•••••••• (leave blank to keep)" : "Not set"}
        onChange={(e) => onChange(e.target.value)}
      />
      {hasValue && (
        <label className="mt-1.5 flex items-center gap-2 text-xs text-mist">
          <input
            type="checkbox"
            checked={clearing}
            onChange={(e) => onClearingChange(e.target.checked)}
            className="h-3.5 w-3.5 accent-[color:var(--color-brand)]"
          />
          Clear stored value
        </label>
      )}
      {hint && <span className="mt-1.5 block text-xs text-mist">{hint}</span>}
    </label>
  );
}

/** Channel status pill: off, on-but-unconfigured, or live. */
function ChannelBadge({ enabled, configured }: { enabled: boolean; configured: boolean }) {
  if (!enabled) return <Badge tone="neutral">Off</Badge>;
  return configured ? <Badge tone="ok">Active</Badge> : <Badge tone="warn">Not configured</Badge>;
}

/** Read-only label/value row for environment-owned configuration. */
function StatusRow({
  label,
  value,
  mono,
  tone,
}: {
  label: string;
  value: string;
  mono?: boolean;
  tone?: "ok" | "warn" | "danger";
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-white/5 pb-2">
      <dt className="text-[11px] font-bold uppercase tracking-[0.12em] text-mist">{label}</dt>
      <dd className={`text-right text-sm ${mono ? "font-mono text-xs" : "text-soft"}`}>
        {tone ? <Badge tone={tone}>{value}</Badge> : value}
      </dd>
    </div>
  );
}

/**
 * The APIs manager — every outbound credential the platform uses, in one place:
 * the payment gateway, SMTP email, WhatsApp Cloud API, and the Telegram bot.
 *
 * SUPERADMIN only. Secrets are write-only end to end: this screen can confirm a
 * key is set and where it came from, and can replace or clear it, but it can
 * never read one back. A value saved here overrides the server environment;
 * clearing it hands control back to `.env`.
 */
export function IntegrationsTab() {
  const { data, error, loading } = useAsync(fetchIntegrations);

  const [gateway, setGateway] = useState<GatewaySettingsDto | null>(null);
  const [integrations, setIntegrations] = useState<IntegrationsDto | null>(null);

  // Payment-gateway secrets are environment-only — there is nothing to edit here.
  // Email secrets — one per provider; only the selected one is shown.
  const [smtpUrl, setSmtpUrl] = useState("");
  const [clearSmtpUrl, setClearSmtpUrl] = useState(false);
  const [resendKey, setResendKey] = useState("");
  const [clearResendKey, setClearResendKey] = useState(false);
  const [waToken, setWaToken] = useState("");
  const [clearWaToken, setClearWaToken] = useState(false);
  const [tgToken, setTgToken] = useState("");
  const [clearTgToken, setClearTgToken] = useState(false);

  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  // The settlement webhook. Read on demand, never rendered by default — a
  // secret on screen is a secret in a screenshot.
  const [revealed, setRevealed] = useState<GatewayWebhookDto | null>(null);
  const [revealBusy, setRevealBusy] = useState(false);

  async function onRevealWebhook() {
    setRevealBusy(true);
    try {
      setRevealed(await fetchGatewayWebhook());
    } catch {
      setNote({ tone: "error", text: "Could not read the webhook configuration." });
    } finally {
      setRevealBusy(false);
    }
  }

  useEffect(() => {
    if (data) {
      setGateway(data.gateway);
      setIntegrations(data.integrations);
    }
  }, [data]);

  function patchIntegrations(changes: Partial<IntegrationsDto>) {
    setIntegrations((i) => (i ? { ...i, ...changes } : i));
  }

  /** Run a save, holding the button and surfacing one error message. */
  async function run(key: string, fn: () => Promise<void>) {
    setBusy(key);
    setNote(null);
    try {
      await fn();
    } catch (err) {
      setNote({ tone: "error", text: err instanceof ApiError ? err.message : "Could not save" });
    } finally {
      setBusy(null);
    }
  }

  async function submitEmail(event: React.FormEvent) {
    event.preventDefault();
    if (!integrations) return;
    await run("email", async () => {
      const saved = await saveIntegrations({
        email: {
          provider: integrations.email.provider,
          enabled: integrations.email.enabled,
          from: integrations.email.from,
          replyTo: integrations.email.replyTo,
          smtpUrl: clearSmtpUrl ? null : smtpUrl.length > 0 ? smtpUrl : undefined,
          resendApiKey: clearResendKey ? null : resendKey.length > 0 ? resendKey : undefined,
        },
      });
      setIntegrations(saved);
      setSmtpUrl("");
      setClearSmtpUrl(false);
      setResendKey("");
      setClearResendKey(false);
      setNote({ tone: "ok", text: "Email settings saved." });
    });
  }

  async function testEmail() {
    await run("email-test", async () => {
      const result = await sendTestEmail();
      setNote({
        tone: "ok",
        text: `Test email sent to ${result.to} via ${result.provider === "resend" ? "Resend" : "SMTP"}.`,
      });
    });
  }

  async function submitWhatsApp(event: React.FormEvent) {
    event.preventDefault();
    if (!integrations) return;
    await run("whatsapp", async () => {
      const saved = await saveIntegrations({
        whatsapp: {
          enabled: integrations.whatsapp.enabled,
          phoneId: integrations.whatsapp.phoneId,
          token: clearWaToken ? null : waToken.length > 0 ? waToken : undefined,
        },
      });
      setIntegrations(saved);
      setWaToken("");
      setClearWaToken(false);
      setNote({ tone: "ok", text: "WhatsApp settings saved." });
    });
  }

  async function submitTelegram(event: React.FormEvent) {
    event.preventDefault();
    if (!integrations) return;
    await run("telegram", async () => {
      const saved = await saveIntegrations({
        telegram: {
          enabled: integrations.telegram.enabled,
          botToken: clearTgToken ? null : tgToken.length > 0 ? tgToken : undefined,
        },
      });
      setIntegrations(saved);
      setTgToken("");
      setClearTgToken(false);
      setNote({ tone: "ok", text: "Telegram settings saved." });
    });
  }

  if (loading || !gateway || !integrations) {
    return (
      <Panel title="Integrations">
        {error ? <Note tone="error">{error}</Note> : <Empty>Loading…</Empty>}
      </Panel>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {note && <Note tone={note.tone}>{note.text}</Note>}

      {!integrations.secretsEncrypted && (
        <Note tone="warn">
          Secrets are stored <strong>unencrypted</strong>. Set <code>SECRET_ENCRYPTION_KEY</code> on
          the API to encrypt them at rest — generate one with{" "}
          <code>openssl rand -base64 32</code>.
        </Note>
      )}

      <p className="text-sm text-mist">
        Every outbound API credential in one place. The payment gateway is environment-only and shown
        read-only; for the other channels, values saved here override the server environment and
        clearing a secret falls back to <code>.env</code>. Secrets are write-only — the console can
        confirm one is set, never read it back.
      </p>

      {/* ---------------------------------------------------- payment gateway */}
      <Panel
        title="Payment gateway & wallet"
        action={
          gateway.mockActive ? (
            <Badge tone="warn">Mock mode active</Badge>
          ) : (
            <Badge tone="ok">Live rail</Badge>
          )
        }
      >
        <p className="mb-4 text-sm text-mist">
          The Pay2Crypto rail is owned by the server environment — it is not editable here, by
          design. Change <code>PAY2CRYPTO_API_URL</code>, <code>PAY2CRYPTO_TOKEN</code> and{" "}
          <code>PAY2CRYPTO_WEBHOOK_SECRET</code> in the API server&apos;s <code>.env</code> and
          restart it.
        </p>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
          <StatusRow label="Provider" value={gateway.provider} />
          <StatusRow label="API base URL" value={gateway.apiUrl || "—"} mono />
          <StatusRow label="Settlement wallet" value={gateway.walletAddress || "—"} mono />
          <StatusRow label="Default network" value={gateway.network.toUpperCase()} />
          <StatusRow label="Asset" value={gateway.asset} />
          <StatusRow
            label="Merchant token"
            value={gateway.hasToken ? "Set" : "Missing"}
            tone={gateway.hasToken ? "ok" : "danger"}
          />
          <StatusRow
            label="Webhook secret"
            value={gateway.hasWebhookSecret ? "Set" : "Missing"}
            tone={gateway.hasWebhookSecret ? "ok" : "danger"}
          />
          <StatusRow
            label="Mock mode"
            value={gateway.mockActive ? "Active" : "Off"}
            tone={gateway.mockActive ? "warn" : "ok"}
          />
        </dl>
        <p className="mt-4 text-xs text-mist">
          Members pick their own rail at checkout. The rails the account can actually serve are{" "}
          <strong>{(gateway.networks ?? [gateway.network]).map((n) => n.toUpperCase()).join(", ")}</strong>
          {" "}— a rail the gateway has no receiving address for is refused by the gateway, so it is
          not offered.
        </p>
        <div className="mt-4 rounded-lg border border-line p-4">
          <p className="text-sm font-medium text-fog">Settlement webhook (Pay2Crypto dashboard)</p>
          <p className="mt-1 text-xs text-mist">
            Payments settle when Pay2Crypto posts to this URL. Paste it into the gateway&apos;s
            callback settings, or send the secret in the <code>x-pay2crypto-secret</code> header
            instead.
          </p>
          {revealed ? (
            <div className="mt-3 space-y-2 text-xs">
              <div className="rounded bg-ink p-2 font-mono break-all text-mist">
                {revealed.url}
              </div>
              <div className="rounded bg-ink p-2 font-mono break-all text-mist">
                header secret: {revealed.secret}
              </div>
            </div>
          ) : (
            <ActionButton
              tone="quiet"
              className="mt-3"
              onClick={onRevealWebhook}
              disabled={revealBusy}
            >
              {revealBusy ? "Loading…" : "Show webhook URL & secret"}
            </ActionButton>
          )}
        </div>
      </Panel>

      {/* ------------------------------------------------------------- email */}
      <Panel
        title="Email"
        action={
          integrations.email.configured ? (
            <Badge tone="ok">Active</Badge>
          ) : integrations.email.enabled ? (
            <Badge tone="warn">Not configured</Badge>
          ) : (
            <Badge tone="neutral">Off</Badge>
          )
        }
      >
        <p className="mb-4 text-sm text-mist">
          Transactional and signal email. Choose a provider: SMTP (Mailgun and most relays — paste
          the connection URL) or Resend (paste the API key). The From address must be on a domain
          verified with your provider.
        </p>
        <form onSubmit={submitEmail} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-[0.12em] text-mist">
              Provider
            </span>
            <div className="inline-flex rounded-2xl border border-white/10 bg-night-2 p-1">
              {(["smtp", "resend"] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() =>
                    patchIntegrations({ email: { ...integrations.email, provider: p } })
                  }
                  className={`rounded-xl px-4 py-2 text-sm font-bold transition ${
                    integrations.email.provider === p
                      ? "bg-brand text-night"
                      : "text-mist hover:text-soft"
                  }`}
                >
                  {p === "smtp" ? "SMTP" : "Resend"}
                </button>
              ))}
            </div>
          </div>

          {integrations.email.provider === "resend" ? (
            <div className="sm:col-span-2">
              <SecretField
                label="Resend API key"
                hint="From resend.com → API Keys. Starts with re_."
                hasValue={integrations.email.hasResendApiKey}
                source={integrations.email.resendApiKeySource}
                value={resendKey}
                onChange={setResendKey}
                clearing={clearResendKey}
                onClearingChange={setClearResendKey}
              />
            </div>
          ) : (
            <div className="sm:col-span-2">
              <SecretField
                label="SMTP URL"
                hint="Format: smtps://user:password@host:465"
                hasValue={integrations.email.hasSmtpUrl}
                source={integrations.email.smtpUrlSource}
                value={smtpUrl}
                onChange={setSmtpUrl}
                clearing={clearSmtpUrl}
                onClearingChange={setClearSmtpUrl}
              />
            </div>
          )}

          <Field
            label="From address"
            value={integrations.email.from}
            onChange={(v) => patchIntegrations({ email: { ...integrations.email, from: v } })}
            placeholder="Aglotrends <no-reply@aglotrends.com>"
          />
          <Field
            label="Reply-to"
            value={integrations.email.replyTo}
            onChange={(v) => patchIntegrations({ email: { ...integrations.email, replyTo: v } })}
            placeholder="support@aglotrends.com"
          />
          <div className="sm:col-span-2">
            <Toggle
              label="Send email"
              hint="Master switch. When off, email deliveries are recorded as skipped, not failed."
              checked={integrations.email.enabled}
              onChange={(v) =>
                patchIntegrations({ email: { ...integrations.email, enabled: v } })
              }
            />
          </div>
          <div className="flex flex-col gap-2 sm:col-span-2 sm:flex-row">
            <ActionButton type="submit" disabled={busy === "email"} className="flex-1">
              {busy === "email" ? "Saving…" : "Save email settings"}
            </ActionButton>
            <ActionButton
              type="button"
              tone="quiet"
              onClick={testEmail}
              disabled={busy === "email-test" || !integrations.email.configured}
              className="flex-1"
            >
              {busy === "email-test" ? "Sending…" : "Send test email"}
            </ActionButton>
          </div>
        </form>
      </Panel>

      {/* ---------------------------------------------------------- whatsapp */}
      <Panel
        title="WhatsApp Cloud API"
        action={
          integrations.whatsapp.configured ? (
            <Badge tone="ok">Active</Badge>
          ) : integrations.whatsapp.enabled ? (
            <Badge tone="warn">Not configured</Badge>
          ) : (
            <Badge tone="neutral">Off</Badge>
          )
        }
      >
        <p className="mb-4 text-sm text-mist">
          Signal delivery over WhatsApp. Requires a Meta Cloud API phone number ID and a permanent
          access token.
        </p>
        <form onSubmit={submitWhatsApp} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field
            label="Phone number ID"
            value={integrations.whatsapp.phoneId}
            onChange={(v) =>
              patchIntegrations({
                whatsapp: { ...integrations.whatsapp, phoneId: v },
              })
            }
            placeholder="123456789012345"
          />
          <SecretField
            label="Access token"
            hasValue={integrations.whatsapp.hasToken}
            source={integrations.whatsapp.tokenSource}
            value={waToken}
            onChange={setWaToken}
            clearing={clearWaToken}
            onClearingChange={setClearWaToken}
          />
          <div className="sm:col-span-2">
            <Toggle
              label="Enable WhatsApp delivery"
              hint="Members still opt in individually; this is the platform-wide switch."
              checked={integrations.whatsapp.enabled}
              onChange={(v) =>
                patchIntegrations({ whatsapp: { ...integrations.whatsapp, enabled: v } })
              }
            />
          </div>
          <div className="sm:col-span-2">
            <ActionButton type="submit" disabled={busy === "whatsapp"}>
              {busy === "whatsapp" ? "Saving…" : "Save WhatsApp"}
            </ActionButton>
          </div>
        </form>
      </Panel>

      {/* ---------------------------------------------------------- telegram */}
      <Panel
        title="Telegram bot"
        action={
          integrations.telegram.configured ? (
            <Badge tone="ok">Active</Badge>
          ) : integrations.telegram.enabled ? (
            <Badge tone="warn">Not configured</Badge>
          ) : (
            <Badge tone="neutral">Off</Badge>
          )
        }
      >
        <p className="mb-4 text-sm text-mist">
          Signal delivery over Telegram. Create a bot with <code>@BotFather</code> and paste its
          token.
        </p>
        <form onSubmit={submitTelegram} className="grid grid-cols-1 gap-3">
          <SecretField
            label="Bot token"
            hasValue={integrations.telegram.hasBotToken}
            source={integrations.telegram.botTokenSource}
            value={tgToken}
            onChange={setTgToken}
            clearing={clearTgToken}
            onClearingChange={setClearTgToken}
          />
          <Toggle
            label="Enable Telegram delivery"
            hint="Members still opt in individually; this is the platform-wide switch."
            checked={integrations.telegram.enabled}
            onChange={(v) =>
              patchIntegrations({ telegram: { ...integrations.telegram, enabled: v } })
            }
          />
          <ActionButton type="submit" disabled={busy === "telegram"}>
            {busy === "telegram" ? "Saving…" : "Save Telegram"}
          </ActionButton>
        </form>
      </Panel>
    </div>
  );
}
