"use client";

import { useState } from "react";
import { Badge, Empty, Note, Panel, Table, Td, Tr } from "@/components/portal-ui";
import { useAsync } from "@/lib/hooks";
import { ApiError, fetchAdminKyc, reviewKyc, type AdminKycDto, type KycStatus } from "@/lib/api";
import { formatDateTime } from "@/lib/format";

type Filter = "ALL" | KycStatus;

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

/**
 * KYC/AML review queue. Staff-level (ADMIN or SUPERADMIN) — reviewing identity
 * is routine operations. The document number is only ever shown MASKED; the
 * operator matches the last four characters, not the whole number.
 */
export function KycTab() {
  const { data, error, loading, reload } = useAsync(() => fetchAdminKyc());
  const [filter, setFilter] = useState<Filter>("PENDING");
  const [actionError, setActionError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  async function decide(sub: AdminKycDto, decision: "VERIFIED" | "REJECTED", why?: string) {
    setBusyId(sub.userId);
    setActionError(null);
    setOk(null);
    try {
      await reviewKyc(sub.userId, decision, why);
      setOk(decision === "VERIFIED" ? "Identity verified." : "Submission rejected.");
      setRejectingId(null);
      setReason("");
      reload();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Could not record the decision.");
    } finally {
      setBusyId(null);
    }
  }

  const rows = (data ?? []).filter((s) => filter === "ALL" || s.status === filter);

  return (
    <div className="flex flex-col gap-5">
      {error && <Note tone="error">{error}</Note>}
      {actionError && <Note tone="error">{actionError}</Note>}
      {ok && <Note tone="ok">{ok}</Note>}

      <Panel title="Identity verification">
        <p className="mb-4 text-sm text-mist">
          Withdrawals are locked until a member&apos;s identity is <strong>VERIFIED</strong>. Approve
          only when the submitted details and documents match.
        </p>

        <div className="mb-4 flex flex-wrap gap-2">
          {(["PENDING", "VERIFIED", "REJECTED", "ALL"] as const).map((o) => (
            <button
              key={o}
              type="button"
              onClick={() => setFilter(o)}
              className={`rounded-full px-3 py-1 text-[11px] font-bold transition ${
                filter === o
                  ? "bg-brand text-night"
                  : "border border-white/15 bg-white/5 text-soft hover:bg-white/10"
              }`}
            >
              {o}
            </button>
          ))}
        </div>

        {loading ? (
          <Empty>Loading…</Empty>
        ) : rows.length > 0 ? (
          <Table columns={["Member", "Legal name", "Country", "ID", "Submitted", "Status", ""]}>
            {rows.map((s) => (
              <Tr key={s.id}>
                <Td>
                  <span className="font-semibold">{s.userFullName ?? "—"}</span>
                  <p className="mt-0.5 text-xs text-mist">{s.userEmail ?? s.userId}</p>
                </Td>
                <Td>
                  {s.legalName ?? "—"}
                  {s.dateOfBirth && <p className="mt-0.5 text-xs text-mist">DOB {s.dateOfBirth}</p>}
                </Td>
                <Td className="text-mist">{s.country ?? "—"}</Td>
                <Td>
                  <span className="font-mono text-[11px] text-mist">{s.idNumberMasked ?? "—"}</span>
                  {s.idType && <p className="mt-0.5 text-[10px] uppercase text-mist">{s.idType}</p>}
                </Td>
                <Td className="whitespace-nowrap text-xs text-mist">
                  {s.submittedAt ? formatDateTime(s.submittedAt) : "—"}
                </Td>
                <Td>
                  <Badge tone={kycTone(s.status)}>{s.status}</Badge>
                  {s.status === "REJECTED" && s.rejectionReason && (
                    <p className="mt-0.5 text-[10px] text-mist">{s.rejectionReason}</p>
                  )}
                </Td>
                <Td>
                  {s.status === "PENDING" && (
                    <div className="flex flex-col gap-2">
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          disabled={busyId === s.userId}
                          onClick={() => void decide(s, "VERIFIED")}
                          className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1 text-[11px] font-bold text-emerald-300 transition hover:bg-emerald-400/20 disabled:opacity-40"
                        >
                          Approve
                        </button>
                        <button
                          type="button"
                          disabled={busyId === s.userId}
                          onClick={() => {
                            setRejectingId(rejectingId === s.userId ? null : s.userId);
                            setReason("");
                          }}
                          className="rounded-full border border-red-400/40 bg-red-400/10 px-3 py-1 text-[11px] font-bold text-red-300 transition hover:bg-red-400/20 disabled:opacity-40"
                        >
                          Reject
                        </button>
                      </div>
                      {rejectingId === s.userId && (
                        <div className="flex flex-col gap-2">
                          <input
                            value={reason}
                            onChange={(e) => setReason(e.target.value)}
                            placeholder="Reason (required)"
                            className="w-full rounded-xl border border-white/10 bg-night-2 px-3 py-2 text-xs text-soft outline-none focus:border-brand/50"
                          />
                          <button
                            type="button"
                            disabled={busyId === s.userId || reason.trim().length === 0}
                            onClick={() => void decide(s, "REJECTED", reason.trim())}
                            className="rounded-full border border-red-400/40 bg-red-400/10 px-3 py-1 text-[11px] font-bold text-red-300 transition hover:bg-red-400/20 disabled:opacity-40"
                          >
                            Confirm rejection
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </Td>
              </Tr>
            ))}
          </Table>
        ) : (
          <Empty>Nothing in this queue.</Empty>
        )}
      </Panel>
    </div>
  );
}
