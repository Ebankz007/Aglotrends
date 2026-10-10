"use client";

import { useEffect, useState } from "react";
import { ActionButton, Badge, Empty, Field, Note, Panel } from "@/components/portal-ui";
import { useAsync } from "@/lib/hooks";
import {
  ApiError,
  fetchAdminSettings,
  fetchMe,
  saveGatewaySettings,
  savePlatformSettings,
  type AdminSettingsDto,
  type GatewaySettingsDto,
  type PlatformSettingsDto,
} from "@/lib/api";

const inputClass =
  "w-full rounded-2xl border border-white/10 bg-night-2 px-4 py-3 text-[15px] text-soft outline-none transition focus:border-brand/50";

function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-white/10 bg-night-2 px-4 py-3">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 accent-[color:var(--color-brand)]"
      />
      <span>
        <span className="block text-sm font-bold text-soft">{label}</span>
        {hint && <span className="mt-0.5 block text-xs text-mist">{hint}</span>}
      </span>
    </label>
  );
}

function sourceLabel(source: GatewaySettingsDto["tokenSource"]): string {
  return source === "database" ? "set in console" : source === "environment" ? "from .env" : "not set";
}

/**
 * Platform settings — SUPERADMIN only. Two things live here: the payment
 * gateway (which wallet the rail settles to, and the merchant credentials) and
 * the platform switches. Secrets are write-only: the API returns whether a
 * value is set and where it came from, never the value itself.
 */
export function SettingsTab() {
  const { data: me, loading: meLoading } = useAsync(fetchMe);
  const { data, error, loading, reload } = useAsync(fetchAdminSettings);

  const [gateway, setGateway] = useState<GatewaySettingsDto | null>(null);
  const [platform, setPlatform] = useState<PlatformSettingsDto | null>(null);

  const [token, setToken] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [clearToken, setClearToken] = useState(false);
  const [clearSecret, setClearSecret] = useState(false);

  const [savingGateway, setSavingGateway] = useState(false);
  const [savingPlatform, setSavingPlatform] = useState(false);
  const [note, setNote] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  useEffect(() => {
    if (data) {
      setGateway(data.gateway);
      setPlatform(data.platform);
    }
  }, [data]);

  const isSuperAdmin = me?.role === "SUPERADMIN";

  function patchGateway(changes: Partial<GatewaySettingsDto>) {
    setGateway((g) => (g ? { ...g, ...changes } : g));
  }

  async function submitGateway(event: React.FormEvent) {
    event.preventDefault();
    if (!gateway) return;
    setSavingGateway(true);
    setNote(null);
    try {
      const saved = await saveGatewaySettings({
        provider: gateway.provider,
        apiUrl: gateway.apiUrl,
        walletAddress: gateway.walletAddress,
        network: gateway.network,
        asset: gateway.asset,
        forceMock: gateway.forceMock,
        // undefined = leave as-is; null = clear; string = set.
        token: clearToken ? null : token.length > 0 ? token : undefined,
        webhookSecret: clearSecret ? null : webhookSecret.length > 0 ? webhookSecret : undefined,
      });
      setGateway(saved);
      setToken("");
      setWebhookSecret("");
      setClearToken(false);
      setClearSecret(false);
      setNote({ tone: "ok", text: "Gateway settings saved." });
    } catch (err) {
      setNote({
        tone: "error",
        text: err instanceof ApiError ? err.message : "Could not save gateway settings",
      });
    } finally {
      setSavingGateway(false);
    }
  }

  async function submitPlatform(event: React.FormEvent) {
    event.preventDefault();
    if (!platform) return;
    setSavingPlatform(true);
    setNote(null);
    try {
      const saved = await savePlatformSettings(platform);
      setPlatform(saved);
      setNote({ tone: "ok", text: "Platform settings saved." });
    } catch (err) {
      setNote({
        tone: "error",
        text: err instanceof ApiError ? err.message : "Could not save platform settings",
      });
    } finally {
      setSavingPlatform(false);
    }
  }

  if (meLoading) {
    return (
      <Panel title="Settings">
        <Empty>Loading…</Empty>
      </Panel>
    );
  }

  if (!isSuperAdmin) {
    return (
      <Panel title="Settings">
        <Note tone="info">Only a SUPERADMIN can view or change platform settings.</Note>
      </Panel>
    );
  }

  if (loading || !gateway || !platform) {
    return (
      <Panel title="Settings">
        {error ? <Note tone="error">{error}</Note> : <Empty>Loading…</Empty>}
      </Panel>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {note && <Note tone={note.tone}>{note.text}</Note>}

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
          Where the rail settles and which merchant credentials it uses. Values saved here override
          the server environment; clearing a secret falls back to <code>.env</code>.
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

          <label className="block">
            <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-[0.12em] text-mist">
              Merchant token — {sourceLabel(gateway.tokenSource)}
            </span>
            <input
              type="password"
              className={inputClass}
              value={token}
              disabled={clearToken}
              autoComplete="new-password"
              placeholder={gateway.hasToken ? "•••••••• (leave blank to keep)" : "Not set"}
              onChange={(e) => setToken(e.target.value)}
            />
            {gateway.hasToken && (
              <label className="mt-1.5 flex items-center gap-2 text-xs text-mist">
                <input
                  type="checkbox"
                  checked={clearToken}
                  onChange={(e) => setClearToken(e.target.checked)}
                  className="h-3.5 w-3.5 accent-[color:var(--color-brand)]"
                />
                Clear stored token
              </label>
            )}
          </label>

          <label className="block">
            <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-[0.12em] text-mist">
              Webhook secret — {sourceLabel(gateway.webhookSecretSource)}
            </span>
            <input
              type="password"
              className={inputClass}
              value={webhookSecret}
              disabled={clearSecret}
              autoComplete="new-password"
              placeholder={gateway.hasWebhookSecret ? "•••••••• (leave blank to keep)" : "Not set"}
              onChange={(e) => setWebhookSecret(e.target.value)}
            />
            {gateway.hasWebhookSecret && (
              <label className="mt-1.5 flex items-center gap-2 text-xs text-mist">
                <input
                  type="checkbox"
                  checked={clearSecret}
                  onChange={(e) => setClearSecret(e.target.checked)}
                  className="h-3.5 w-3.5 accent-[color:var(--color-brand)]"
                />
                Clear stored secret
              </label>
            )}
          </label>

          <div className="sm:col-span-2">
            <Toggle
              label="Force mock mode"
              hint="Issue synthetic checkout URLs even when credentials are present. Never enable in production."
              checked={gateway.forceMock}
              onChange={(v) => patchGateway({ forceMock: v })}
            />
          </div>

          <div className="sm:col-span-2">
            <ActionButton type="submit" disabled={savingGateway}>
              {savingGateway ? "Saving…" : "Save gateway settings"}
            </ActionButton>
          </div>
        </form>
      </Panel>

      <Panel title="Platform">
        <form onSubmit={submitPlatform} className="flex flex-col gap-3">
          <Field
            label="Platform name"
            value={platform.name}
            onChange={(v) => setPlatform({ ...platform, name: v })}
            placeholder="Aglotrends"
          />
          <Toggle
            label="Registration open"
            hint="When off, new sign-ups are refused at the API."
            checked={platform.registrationOpen}
            onChange={(v) => setPlatform({ ...platform, registrationOpen: v })}
          />
          <ActionButton type="submit" disabled={savingPlatform}>
            {savingPlatform ? "Saving…" : "Save platform settings"}
          </ActionButton>
        </form>
      </Panel>
    </div>
  );
}
