"use client";

import { useState } from "react";
import { ActionButton, Badge, Field, Note, Panel } from "@/components/portal-ui";
import { ApiError, submitKyc, type KycDto } from "@/lib/api";
import { formatDateTime } from "@/lib/format";

function kycTone(status: string): "neutral" | "ok" | "warn" | "danger" {
  switch (status) {
    case "VERIFIED":
      return "ok";
    case "PENDING":
      return "warn";
    case "REJECTED":
      return "danger";
    default:
      return "neutral";
  }
}

const ID_TYPES = [
  { value: "PASSPORT", label: "Passport" },
  { value: "NATIONAL_ID", label: "National ID" },
  { value: "DRIVERS_LICENSE", label: "Driver's license" },
];

/**
 * Member-facing identity verification. KYC gates WITHDRAWALS only — a member
 * can register, pay, and earn without it, but no money leaves until an operator
 * has verified them. The document number is never echoed back in full.
 */
export function KycPanel({ kyc, onSubmitted }: { kyc: KycDto; onSubmitted: () => void }) {
  const [legalName, setLegalName] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [country, setCountry] = useState("");
  const [address, setAddress] = useState("");
  const [idType, setIdType] = useState("PASSPORT");
  const [idNumber, setIdNumber] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setOk(null);
    if (
      !legalName.trim() ||
      !dateOfBirth ||
      !country.trim() ||
      !address.trim() ||
      !idNumber.trim()
    ) {
      setError("Please complete every field.");
      return;
    }
    setBusy(true);
    try {
      await submitKyc({
        legalName: legalName.trim(),
        dateOfBirth,
        country: country.trim(),
        address: address.trim(),
        idType,
        idNumber: idNumber.trim(),
      });
      setOk("Submitted. An operator will review your identity.");
      setLegalName("");
      setDateOfBirth("");
      setCountry("");
      setAddress("");
      setIdNumber("");
      onSubmitted();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not submit your details.");
    } finally {
      setBusy(false);
    }
  }

  const canSubmit = kyc.status === "NOT_STARTED" || kyc.status === "REJECTED";

  return (
    <Panel
      title="Identity verification"
      action={<Badge tone={kycTone(kyc.status)}>{kyc.status.replace("_", " ")}</Badge>}
    >
      {kyc.status === "VERIFIED" && (
        <p className="text-sm text-mist">
          Your identity is verified — withdrawals are unlocked.
          {kyc.legalName && (
            <>
              {" "}
              Verified as <span className="font-semibold text-soft">{kyc.legalName}</span>.
            </>
          )}
        </p>
      )}

      {kyc.status === "PENDING" && (
        <p className="text-sm text-mist">
          Your submission is under review. Withdrawals unlock once an operator approves it.
          {kyc.submittedAt && <> Submitted {formatDateTime(kyc.submittedAt)}.</>}
        </p>
      )}

      {kyc.status === "REJECTED" && (
        <div className="mb-4">
          <Note tone="error">
            Your last submission was rejected.
            {kyc.rejectionReason && <> Reason: {kyc.rejectionReason}.</>} Please resubmit below.
          </Note>
        </div>
      )}

      {canSubmit && (
        <>
          <p className="mb-4 text-sm text-mist">
            Required before you can withdraw. Your document number is stored securely and never shown
            in full.
          </p>
          <form onSubmit={onSubmit} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field
              label="Full legal name"
              value={legalName}
              onChange={setLegalName}
              placeholder="As on your ID"
            />
            <Field label="Date of birth" type="date" value={dateOfBirth} onChange={setDateOfBirth} />
            <Field label="Country" value={country} onChange={setCountry} placeholder="Philippines" />
            <Field
              label="Address"
              value={address}
              onChange={setAddress}
              placeholder="Street, city, postal code"
            />
            <label className="block">
              <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-[0.12em] text-mist">
                ID type
              </span>
              <select
                value={idType}
                onChange={(e) => setIdType(e.target.value)}
                className="w-full rounded-2xl border border-white/10 bg-night-2 px-4 py-3 text-[15px] text-soft outline-none transition focus:border-brand/50"
              >
                {ID_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </label>
            <Field
              label="ID number"
              value={idNumber}
              onChange={setIdNumber}
              placeholder="Document number"
            />
            {error && (
              <div className="sm:col-span-2">
                <Note tone="error">{error}</Note>
              </div>
            )}
            {ok && (
              <div className="sm:col-span-2">
                <Note tone="ok">{ok}</Note>
              </div>
            )}
            <div className="sm:col-span-2">
              <ActionButton type="submit" disabled={busy}>
                {busy ? "Submitting…" : "Submit for verification"}
              </ActionButton>
            </div>
          </form>
        </>
      )}
    </Panel>
  );
}
