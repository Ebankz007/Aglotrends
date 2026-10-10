"use client";

import { useState } from "react";
import { Badge, Empty, Note, Panel, Stat, Table, Td, Tr } from "@/components/portal-ui";
import { useAsync } from "@/lib/hooks";
import { ApiError, cancelPayment, confirmPayment, fetchAdminPayments } from "@/lib/api";
import { formatCents, formatDateTime } from "@/lib/format";

type PurposeFilter = "ALL" | "REGISTRATION" | "DEPOSIT";
type StatusFilter = "ALL" | "PENDING" | "PAID" | "EXPIRED" | "FAILED";

function paymentTone(status: string): "neutral" | "ok" | "warn" | "danger" | "info" {
  switch (status) {
    case "PAID":
      return "ok";
    case "PENDING":
      return "warn";
    case "FAILED":
      return "danger";
    default:
      return "neutral";
  }
}

function FilterGroup<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly T[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] font-bold uppercase tracking-wide text-mist">{label}</span>
      <div className="flex flex-wrap gap-1">
        {options.map((o) => (
          <button
            key={o}
            type="button"
            onClick={() => onChange(o)}
            className={`rounded-full px-3 py-1 text-[11px] font-bold transition ${
              value === o
                ? "bg-brand text-night"
                : "border border-white/15 bg-white/5 text-soft hover:bg-white/10"
            }`}
          >
            {o}
          </button>
        ))}
      </div>
    </div>
  );
}

export function PaymentsTab() {
  const { data, error, loading, reload } = useAsync(fetchAdminPayments);
  const [purpose, setPurpose] = useState<PurposeFilter>("ALL");
  const [status, setStatus] = useState<StatusFilter>("ALL");
  const [actionError, setActionError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function act(id: string, fn: (id: string) => Promise<unknown>, msg: string) {
    setBusyId(id);
    setActionError(null);
    setOk(null);
    try {
      await fn(id);
      setOk(msg);
      reload();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Action failed.");
    } finally {
      setBusyId(null);
    }
  }

  const rows = (data?.payments ?? []).filter(
    (p) =>
      (purpose === "ALL" || p.purpose === purpose) && (status === "ALL" || p.status === status),
  );
  const s = data?.summary;

  return (
    <div className="flex flex-col gap-5">
      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Registration collected"
          value={loading ? "…" : formatCents(s?.registrationCollectedCents ?? 0)}
          hint={loading ? undefined : `${s?.registrationPaidCount ?? 0} paid`}
        />
        <Stat
          label="Registration pending"
          value={loading ? "…" : String(s?.registrationPendingCount ?? 0)}
          hint="awaiting confirmation"
        />
        <Stat
          label="Deposits collected"
          value={loading ? "…" : formatCents(s?.depositCollectedCents ?? 0)}
          hint={loading ? undefined : `${s?.depositPaidCount ?? 0} paid`}
        />
        <Stat
          label="Deposits pending"
          value={loading ? "…" : String(s?.depositPendingCount ?? 0)}
          hint="awaiting confirmation"
        />
      </section>

      {error && <Note tone="error">{error}</Note>}
      {actionError && <Note tone="error">{actionError}</Note>}
      {ok && <Note tone="ok">{ok}</Note>}

      <Panel title="Invoices">
        <div className="mb-4 flex flex-wrap gap-6">
          <FilterGroup
            label="Purpose"
            value={purpose}
            options={["ALL", "REGISTRATION", "DEPOSIT"] as const}
            onChange={setPurpose}
          />
          <FilterGroup
            label="Status"
            value={status}
            options={["ALL", "PENDING", "PAID", "EXPIRED", "FAILED"] as const}
            onChange={setStatus}
          />
        </div>

        {loading ? (
          <Empty>Loading…</Empty>
        ) : rows.length > 0 ? (
          <Table columns={["Member", "Purpose", "Amount", "Status", "Reference", "Created", ""]}>
            {rows.map((p) => (
              <Tr key={p.id}>
                <Td>
                  <span className="font-semibold">{p.userFullName}</span>
                  <p className="mt-0.5 text-xs text-mist">{p.userEmail}</p>
                </Td>
                <Td>
                  <Badge tone={p.purpose === "REGISTRATION" ? "info" : "neutral"}>
                    {p.purpose === "REGISTRATION" ? "Registration" : "Deposit"}
                  </Badge>
                </Td>
                <Td className="font-semibold">{formatCents(p.amountCents)}</Td>
                <Td>
                  <Badge tone={paymentTone(p.status)}>{p.status}</Badge>
                </Td>
                <Td>
                  <span className="font-mono text-[11px] text-mist">{p.paymentRef}</span>
                  {p.txHash && <p className="mt-0.5 font-mono text-[10px] text-mist">{p.txHash}</p>}
                </Td>
                <Td className="whitespace-nowrap text-xs text-mist">
                  {formatDateTime(p.paidAt ?? p.createdAt)}
                </Td>
                <Td>
                  <div className="flex flex-wrap gap-2">
                    {(p.status === "PENDING" || p.status === "EXPIRED") && (
                      <button
                        type="button"
                        disabled={busyId === p.id}
                        onClick={() => void act(p.id, confirmPayment, "Payment confirmed.")}
                        className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1 text-[11px] font-bold text-emerald-300 transition hover:bg-emerald-400/20"
                      >
                        Confirm
                      </button>
                    )}
                    {p.status === "PENDING" && (
                      <button
                        type="button"
                        disabled={busyId === p.id}
                        onClick={() => void act(p.id, cancelPayment, "Invoice cancelled.")}
                        className="rounded-full border border-red-400/40 bg-red-400/10 px-3 py-1 text-[11px] font-bold text-red-300 transition hover:bg-red-400/20"
                      >
                        Cancel
                      </button>
                    )}
                  </div>
                </Td>
              </Tr>
            ))}
          </Table>
        ) : (
          <Empty>No invoices match this filter.</Empty>
        )}
        <p className="mt-3 text-xs text-mist">
          <span className="font-bold text-soft">Confirm</span> settles an invoice off-rail (cash, a
          transfer, or a lost webhook) through the same idempotent path as the gateway — a
          registration activates the member and distributes compensation exactly once.{" "}
          <span className="font-bold text-soft">Cancel</span> expires a stale pending invoice with no
          ledger effect.
        </p>
      </Panel>

      <Panel title="Awaiting activation">
        {loading ? (
          <Empty>Loading…</Empty>
        ) : data && data.unpaidMembers.length > 0 ? (
          <Table columns={["Member", "Email", "Joined"]}>
            {data.unpaidMembers.map((m) => (
              <Tr key={m.id}>
                <Td className="font-semibold">{m.fullName}</Td>
                <Td className="text-mist">{m.email}</Td>
                <Td className="whitespace-nowrap text-xs text-mist">{formatDateTime(m.createdAt)}</Td>
              </Tr>
            ))}
          </Table>
        ) : (
          <Empty>Every member has settled the registration fee.</Empty>
        )}
        <p className="mt-3 text-xs text-mist">
          Members who registered but never paid the $20 fee — the chase list. A member deactivated by
          hand keeps a registration row and is deliberately not shown here.
        </p>
      </Panel>
    </div>
  );
}
