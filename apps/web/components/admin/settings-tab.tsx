"use client";

import { useEffect, useState } from "react";
import { ActionButton, Badge, Empty, Field, Note, Panel, Toggle } from "@/components/portal-ui";
import { useAsync } from "@/lib/hooks";
import {
  ApiError,
  fetchAdminSettings,
  fetchMe,
  savePlatformFeeSettings,
  savePlatformSettings,
  type PlatformFeeSettingsDto,
  type PlatformSettingsDto,
} from "@/lib/api";

/**
 * Platform settings — SUPERADMIN only. The platform switches and the
 * transaction-fee wallet live here. API credentials (the payment gateway, SMTP,
 * WhatsApp, Telegram) moved to the **Integrations** tab, so every secret the
 * platform holds is managed in exactly one place.
 */
export function SettingsTab() {
  const { data: me, loading: meLoading } = useAsync(fetchMe);
  const { data, error, loading } = useAsync(fetchAdminSettings);

  const [platform, setPlatform] = useState<PlatformSettingsDto | null>(null);
  const [fees, setFees] = useState<PlatformFeeSettingsDto | null>(null);
  const [feeAmount, setFeeAmount] = useState("");

  const [savingPlatform, setSavingPlatform] = useState(false);
  const [savingFees, setSavingFees] = useState(false);
  const [note, setNote] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  useEffect(() => {
    if (data) {
      setPlatform(data.platform);
      setFees(data.fees);
      setFeeAmount((data.fees.amountCents / 100).toFixed(2));
    }
  }, [data]);

  const isSuperAdmin = me?.role === "SUPERADMIN";

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

  async function submitFees(event: React.FormEvent) {
    event.preventDefault();
    if (!fees) return;
    setSavingFees(true);
    setNote(null);
    try {
      const parsed = Number.parseFloat(feeAmount.replace(/[^0-9.]/g, ""));
      const amountCents = Number.isFinite(parsed) ? Math.round(parsed * 100) : fees.amountCents;
      const saved = await savePlatformFeeSettings({
        walletAddress: fees.walletAddress,
        network: fees.network,
        asset: fees.asset,
        amountCents,
        enabled: fees.enabled,
      });
      setFees(saved);
      setFeeAmount((saved.amountCents / 100).toFixed(2));
      setNote({ tone: "ok", text: "Transaction fee settings saved." });
    } catch (err) {
      setNote({
        tone: "error",
        text: err instanceof ApiError ? err.message : "Could not save fee settings",
      });
    } finally {
      setSavingFees(false);
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

  if (loading || !platform || !fees) {
    return (
      <Panel title="Settings">
        {error ? <Note tone="error">{error}</Note> : <Empty>Loading…</Empty>}
      </Panel>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {note && <Note tone={note.tone}>{note.text}</Note>}

      <Note tone="info">
        Looking for the payment gateway, SMTP, WhatsApp, or Telegram credentials? Those now live in
        the <strong>Integrations</strong> tab.
      </Note>

      <Panel title="Platform">
        <form onSubmit={submitPlatform} className="grid grid-cols-1 gap-3">
          <Field
            label="Platform name"
            value={platform.name}
            onChange={(v) => setPlatform({ ...platform, name: v })}
            placeholder="Aglotrends"
          />
          <Toggle
            label="Registration open"
            hint="When off, new members cannot create an account."
            checked={platform.registrationOpen}
            onChange={(v) => setPlatform({ ...platform, registrationOpen: v })}
          />
          <ActionButton type="submit" disabled={savingPlatform}>
            {savingPlatform ? "Saving…" : "Save platform settings"}
          </ActionButton>
        </form>
      </Panel>

      <Panel
        title="Transaction fee wallet"
        action={
          fees.enabled ? <Badge tone="ok">Collecting</Badge> : <Badge tone="warn">Disabled</Badge>
        }
      >
        <p className="mb-4 text-sm text-mist">
          A flat fee withheld from every inbound gateway payment and routed to this wallet. This is
          platform revenue, separate from the compensation plan — the fee is carved out before the
          engine runs, so the registration base and its split are untouched. Settlement is manual;
          mark rows settled in the <strong>Fees</strong> tab once you have moved the funds.
        </p>
        {!fees.walletConfigured && (
          <div className="mb-4">
            <Note tone="warn">
              No fee wallet is configured. Fees are still recorded, but you cannot route the funds
              until you set an address.
            </Note>
          </div>
        )}
        <form onSubmit={submitFees} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field
            label="Fee wallet address"
            value={fees.walletAddress}
            onChange={(v) => setFees({ ...fees, walletAddress: v })}
            placeholder="TQn9… (TRC20)"
          />
          <div className="grid grid-cols-2 gap-3">
            <Field
              label="Network"
              value={fees.network}
              onChange={(v) => setFees({ ...fees, network: v })}
              placeholder="trc20"
            />
            <Field
              label="Asset"
              value={fees.asset}
              onChange={(v) => setFees({ ...fees, asset: v })}
              placeholder="USDT"
            />
          </div>
          <Field
            label="Fee per payment (USD)"
            value={feeAmount}
            onChange={setFeeAmount}
            placeholder="3.00"
          />
          <div className="sm:col-span-2">
            <Toggle
              label="Collect transaction fees"
              hint="When on, the fee above is added to every inbound payment. When off, no fee is charged."
              checked={fees.enabled}
              onChange={(v) => setFees({ ...fees, enabled: v })}
            />
          </div>
          <div className="sm:col-span-2">
            <ActionButton type="submit" disabled={savingFees}>
              {savingFees ? "Saving…" : "Save fee settings"}
            </ActionButton>
          </div>
        </form>
      </Panel>
    </div>
  );
}
