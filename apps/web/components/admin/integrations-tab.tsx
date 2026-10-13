"use client";

import { useEffect, useState } from "react";
import { ActionButton, Badge, Empty, Field, Note, Panel, Toggle } from "@/components/portal-ui";
import { useAsync } from "@/lib/hooks";
import {
  ApiError,
  fetchIntegrations,
  saveGatewaySettings,
  saveIntegrations,
  type GatewaySettingsDto,
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

  // Payment-gateway secrets.
  const [gwToken, setGwToken] = useState("");
  const [gwSecret, setGwSecret] = useState("");
  const [clearGwToken, setClearGwToken] = useState(false);
  const [clearGwSecret, setClearGwSecret] = useState(false);

  // Messaging-channel secrets.
  const [smtpUrl, setSmtpUrl] = useState("");
  const [clearSmtpUrl, setClearSmtpUrl] = useState(false);
  const [waToken, setWaToken] = useState("");
  const [clearWaToken, setClearWaToken] = useState(false);
  const [tgToken, setTgToken] = useState("");
  const [clearTgToken, setClearTgToken] = useState(false);

  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  useEffect(() => {
    if (data) {
      setGateway(data.gateway);
      setIntegrations(data.integrations);
    }
  }, [data]);

  function patchGateway(changes: Partial<GatewaySettingsDto>) {
    setGateway((g) => (g ? { ...g, ...changes } : g));
  }

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

  async function submitGateway(event: React.FormEvent) {
    event.preventDefault();
    if (!gateway) return;
    await run("gateway", async () => {
      const saved = await saveGatewaySettings({
        provider: gateway.provider,
        apiUrl: gateway.apiUrl,
        walletAddress: gateway.walletAddress,
        network: gateway.network,
        asset: gateway.asset,
        forceMock: gateway.forceMock,
        // undefined = leave as-is; null = clear; string = set.
        token: clearGwToken ? null : gwToken.length > 0 ? gwToken : undefined,
        webhookSecret: clearGwSecret ? null : gwSecret.length > 0 ? gwSecret : undefined,
      });
      setGateway(saved);
      setGwToken("");
      setGwSecret("");
      setClearGwToken(false);
      setClearGwSecret(false);
      setNote({ tone: "ok", text: "Payment gateway saved." });
    });
  }

  async function submitEmail(event: React.FormEvent) {
    event.preventDefault();
    if (!integrations) return;
    await run("email", async () => {
      const saved = await saveIntegrations({
        email: {
          enabled: integrations.email.enabled,
          from: integrations.email.from,
          replyTo: integrations.email.replyTo,
          smtpUrl: clearSmtpUrl ? null : smtpUrl.length > 0 ? smtpUrl : undefined,
        },
      });
      setIntegrations(saved);
      setSmtpUrl("");
      setClearSmtpUrl(false);
      setNote({ tone: "ok", text: "Email settings saved." });
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
        Every outbound API credential in one place. Values saved here override the server
        environment; clearing a secret falls back to <code>.env</code>. Secrets are write-only — the
        console can confirm one is set, never read it back.
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
          Where the rail settles and which merchant credentials it uses.
        </p>
        <form onSubmit={submitGateway} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field
            label="Provider"
            value={gateway.provider}
            onChange={(v) => patchGateway({ provider: v })}
            placeholder="pay2crypto"
          />
          <Field
            label="API base URL"
            value={gateway.apiUrl}
            onChange={(v) => patchGateway({ apiUrl: v })}
            placeholder="https://api.pay2crypto.com"
          />
          <Field
            label="Settlement wallet address"
            value={gateway.walletAddress}
            onChange={(v) => patchGateway({ walletAddress: v })}
            placeholder="TQn9… (TRC20)"
          />
          <div className="grid grid-cols-2 gap-3">
            <Field
              label="Network"
              value={gateway.network}
              onChange={(v) => patchGateway({ network: v })}
              placeholder="trc20"
            />
            <Field
              label="Asset"
              value={gateway.asset}
              onChange={(v) => patchGateway({ asset: v })}
              placeholder="USDT"
            />
          </div>

          <SecretField
            label="Merchant token"
            hasValue={gateway.hasToken}
            source={gateway.tokenSource}
            value={gwToken}
            onChange={setGwToken}
            clearing={clearGwToken}
            onClearingChange={setClearGwToken}
          />
          <SecretField
            label="Webhook secret"
            hasValue={gateway.hasWebhookSecret}
            source={gateway.webhookSecretSource}
            value={gwSecret}
            onChange={setGwSecret}
            clearing={clearGwSecret}
            onClearingChange={setClearGwSecret}
          />

          <div className="sm:col-span-2">
            <Toggle
              label="Force mock mode"
              hint="Simulate payments instead of hitting the live rail. Never enable this in production."
              checked={gateway.forceMock}
              onChange={(v) => patchGateway({ forceMock: v })}
            />
          </div>
          <div className="sm:col-span-2">
            <ActionButton type="submit" disabled={busy === "gateway"}>
              {busy === "gateway" ? "Saving…" : "Save payment gateway"}
            </ActionButton>
          </div>
        </form>
      </Panel>

      {/* ------------------------------------------------------------- email */}
      <Panel
        title="Email (SMTP)"
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
          Transactional and signal email. Mailgun and most providers are plain SMTP — paste the
          connection URL and the platform parses host, port and credentials from it.
        </p>
        <form onSubmit={submitEmail} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
          <div className="sm:col-span-2">
            <ActionButton type="submit" disabled={busy === "email"}>
              {busy === "email" ? "Saving…" : "Save email settings"}
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
