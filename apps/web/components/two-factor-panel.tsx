"use client";

import { useState } from "react";
import {
  ApiError,
  enableTwoFactor,
  setupTwoFactor,
  type TwoFactorSetupDto,
} from "@/lib/api";
import { ActionButton, Field, Note, Panel } from "@/components/portal-ui";

/**
 * TOTP enrolment. Used as a hard gate in the admin console — staff cannot reach
 * a single admin route until a second factor is enrolled, so this is the only
 * thing they can do — and as a self-service panel elsewhere.
 */
export function TwoFactorEnrollment({
  intro,
  onDone,
}: {
  intro?: React.ReactNode;
  onDone?: () => void;
}) {
  const [setup, setSetup] = useState<TwoFactorSetupDto | null>(null);
  const [code, setCode] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function begin() {
    setError(null);
    setBusy(true);
    try {
      setSetup(await setupTwoFactor());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not start enrolment.");
    } finally {
      setBusy(false);
    }
  }

  async function confirm(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const { recoveryCodes } = await enableTwoFactor(code.trim());
      setRecoveryCodes(recoveryCodes);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not confirm that code.");
    } finally {
      setBusy(false);
    }
  }

  if (recoveryCodes) {
    return (
      <Panel title="Save your recovery codes">
        <Note tone="warn">
          These are shown once. Each code works a single time if you lose your device.
        </Note>
        <div className="mt-3 grid grid-cols-2 gap-2 font-mono text-sm text-soft">
          {recoveryCodes.map((c) => (
            <span key={c} className="rounded-lg border border-white/10 bg-night-2 px-3 py-2">
              {c}
            </span>
          ))}
        </div>
        <div className="mt-4">
          <ActionButton onClick={() => onDone?.()}>I have saved them</ActionButton>
        </div>
      </Panel>
    );
  }

  if (setup) {
    return (
      <Panel title="Scan, then confirm">
        <div className="flex flex-col gap-4 sm:flex-row">
          {/* Data URI from the API — next/image would need a loader for this. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={setup.qrDataUrl}
            alt="Two-factor authentication QR code"
            width={200}
            height={200}
            className="h-[200px] w-[200px] shrink-0 rounded-xl bg-white p-2"
          />
          <div className="flex-1">
            <p className="text-sm text-mist">
              Scan with Google Authenticator, Authy, 1Password or Bitwarden.
            </p>
            <p className="mt-3 text-[11px] font-bold uppercase tracking-[0.12em] text-mist">
              Or enter this key manually
            </p>
            <code className="mt-1 block break-all rounded-lg border border-white/10 bg-night-2 px-3 py-2 font-mono text-xs text-soft">
              {setup.secret}
            </code>
          </div>
        </div>

        <form onSubmit={confirm} className="mt-4 flex flex-col gap-3">
          <Field
            label="6-digit code"
            value={code}
            onChange={setCode}
            placeholder="123456"
            autoComplete="one-time-code"
            inputMode="numeric"
            maxLength={6}
            autoFocus
            required
          />
          {error && <Note tone="error">{error}</Note>}
          <ActionButton type="submit" disabled={busy}>
            {busy ? "Confirming…" : "Confirm and enable"}
          </ActionButton>
        </form>
      </Panel>
    );
  }

  return (
    <Panel title="Two-factor authentication">
      {intro}
      {error && <Note tone="error">{error}</Note>}
      <div className="mt-3">
        <ActionButton onClick={begin} disabled={busy}>
          {busy ? "Preparing…" : "Set up two-factor"}
        </ActionButton>
      </div>
    </Panel>
  );
}
