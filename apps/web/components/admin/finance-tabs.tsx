"use client";

import { useState } from "react";
import {
  ActionButton,
  Badge,
  Empty,
  Field,
  Note,
  Panel,
  Stat,
  Table,
  Td,
  Tr,
} from "@/components/portal-ui";
import { useAsync } from "@/lib/hooks";
import {
  ApiError,
  approvePayout,
  fetchAdminPayouts,
  fetchAdminSettlements,
  fetchPools,
  payPayout,
  recordSettlement,
  rejectPayout,
} from "@/lib/api";
import { formatCents, formatDate, formatDateTime } from "@/lib/format";

/* ---------------------------------------------------------- settlements */

export function SettlementsTab() {
  const { data, error, loading, reload } = useAsync(fetchAdminSettlements);

  const [userId, setUserId] = useState("");
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [profit, setProfit] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setOk(null);
    if (!userId.trim() || !periodStart || !periodEnd) {
      setFormError("User ID and both period dates are required.");
      return;
    }
    const dollars = Number(profit);
    if (!Number.isFinite(dollars)) {
      setFormError("Enter a valid realized profit.");
      return;
    }
    setBusy(true);
    try {
      await recordSettlement({
        userId: userId.trim(),
        periodStart,
        periodEnd,
        realizedProfitCents: Math.round(dollars * 100),
      });
      setOk("Settlement recorded and distributed 60/10/30.");
      setUserId("");
      setPeriodStart("");
      setPeriodEnd("");
      setProfit("");
      reload();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Could not record the settlement.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <Panel title="Record a profit settlement">
        <form onSubmit={onSubmit} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Client user ID (UUID)" value={userId} onChange={setUserId} placeholder="00000000-0000-…" />
          <Field label="Realized profit (USD)" type="number" value={profit} onChange={setProfit} placeholder="250.00" />
          <Field label="Period start" type="date" value={periodStart} onChange={setPeriodStart} />
          <Field label="Period end" type="date" value={periodEnd} onChange={setPeriodEnd} />
          {formError && (
            <div className="sm:col-span-2">
              <Note tone="error">{formError}</Note>
            </div>
          )}
          {ok && (
            <div className="sm:col-span-2">
              <Note tone="ok">{ok}</Note>
            </div>
          )}
          <div className="sm:col-span-2">
            <ActionButton type="submit" disabled={busy}>
              {busy ? "Recording…" : "Record settlement"}
            </ActionButton>
          </div>
          <p className="text-xs text-mist sm:col-span-2">
            Splits realized profit 60% client / 10% sponsor / 30% company. There is no live broker
            feed — this is the admin-entered input the plan depends on.
          </p>
        </form>
      </Panel>

      <Panel title="Settlements">
        {error && <Note tone="error">{error}</Note>}
        {loading ? (
          <Empty>Loading…</Empty>
        ) : data && data.length > 0 ? (
          <Table columns={["Client", "Period", "Realized", "Client", "Sponsor", "Company", "Status"]}>
            {data.map((s) => (
              <Tr key={s.id}>
                <Td className="font-mono text-xs">{s.userId.slice(0, 8)}</Td>
                <Td className="whitespace-nowrap text-xs text-mist">
                  {formatDate(s.periodStart)} – {formatDate(s.periodEnd)}
                </Td>
                <Td>{formatCents(s.realizedProfitCents)}</Td>
                <Td>{formatCents(s.clientCents)}</Td>
                <Td>{formatCents(s.sponsorCents)}</Td>
                <Td>{formatCents(s.companyCents)}</Td>
                <Td>
                  <Badge tone={s.status === "DISTRIBUTED" ? "ok" : "warn"}>{s.status}</Badge>
                </Td>
              </Tr>
            ))}
          </Table>
        ) : (
          <Empty>No settlements recorded yet.</Empty>
        )}
      </Panel>
    </div>
  );
}

/* ---------------------------------------------------------------- pools */

export function PoolsTab() {
  const { data, error, loading } = useAsync(fetchPools);

  return (
    <div className="flex flex-col gap-5">
      {error && <Note tone="error">{error}</Note>}
      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Stat
          label="Rank pool balance"
          value={loading ? "…" : formatCents(data?.balances.RANK ?? 0)}
        />
        <Stat
          label="Leadership pool balance"
          value={loading ? "…" : formatCents(data?.balances.LEADERSHIP ?? 0)}
        />
      </section>

      <Panel title="Pool ledger">
        {loading ? (
          <Empty>Loading…</Empty>
        ) : data && data.entries.length > 0 ? (
          <Table columns={["Pool", "Type", "Amount", "Balance after", "When"]}>
            {data.entries.map((e) => (
              <Tr key={e.id}>
                <Td className="font-semibold">{e.pool}</Td>
                <Td>
                  <Badge tone={e.entryType === "ACCRUAL" ? "info" : "warn"}>{e.entryType}</Badge>
                </Td>
                <Td>{formatCents(e.amountCents)}</Td>
                <Td className="text-mist">{formatCents(e.balanceAfterCents)}</Td>
                <Td className="whitespace-nowrap text-xs text-mist">{formatDateTime(e.createdAt)}</Td>
              </Tr>
            ))}
          </Table>
        ) : (
          <Empty>No pool activity yet.</Empty>
        )}
      </Panel>
    </div>
  );
}

/* -------------------------------------------------------------- payouts */

function payoutTone(status: string): "neutral" | "ok" | "warn" | "danger" | "info" {
  switch (status) {
    case "PAID":
      return "ok";
    case "APPROVED":
      return "info";
    case "REJECTED":
      return "danger";
    default:
      return "warn";
  }
}

export function PayoutsTab() {
  const { data, error, loading, reload } = useAsync(fetchAdminPayouts);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function act(id: string, fn: (id: string) => Promise<unknown>) {
    setBusyId(id);
    setActionError(null);
    try {
      await fn(id);
      reload();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Action failed.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Panel title="Payout requests">
      {error && <Note tone="error">{error}</Note>}
      {actionError && <Note tone="error">{actionError}</Note>}
      {loading ? (
        <Empty>Loading…</Empty>
      ) : data && data.length > 0 ? (
        <Table columns={["Member", "Amount", "Status", "Requested", ""]}>
          {data.map((p) => (
            <Tr key={p.id}>
              <Td className="font-mono text-xs">{p.userId.slice(0, 8)}</Td>
              <Td className="font-semibold">{formatCents(p.amountCents)}</Td>
              <Td>
                <Badge tone={payoutTone(p.status)}>{p.status}</Badge>
              </Td>
              <Td className="whitespace-nowrap text-xs text-mist">{formatDateTime(p.createdAt)}</Td>
              <Td>
                <div className="flex flex-wrap gap-2">
                  {p.status === "REQUESTED" && (
                    <>
                      <button
                        type="button"
                        disabled={busyId === p.id}
                        onClick={() => void act(p.id, approvePayout)}
                        className="rounded-full border border-brand/30 bg-brand/10 px-3 py-1 text-[11px] font-bold text-brand-2 transition hover:bg-brand/20"
                      >
                        Approve
                      </button>
                      <button
                        type="button"
                        disabled={busyId === p.id}
                        onClick={() => void act(p.id, rejectPayout)}
                        className="rounded-full border border-red-400/40 bg-red-400/10 px-3 py-1 text-[11px] font-bold text-red-300 transition hover:bg-red-400/20"
                      >
                        Reject
                      </button>
                    </>
                  )}
                  {p.status === "APPROVED" && (
                    <button
                      type="button"
                      disabled={busyId === p.id}
                      onClick={() => void act(p.id, payPayout)}
                      className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1 text-[11px] font-bold text-emerald-300 transition hover:bg-emerald-400/20"
                    >
                      Mark paid
                    </button>
                  )}
                </div>
              </Td>
            </Tr>
          ))}
        </Table>
      ) : (
        <Empty>No payout requests yet.</Empty>
      )}
    </Panel>
  );
}
