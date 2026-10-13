"use client";

import { useState } from "react";
import { Badge, Empty, Note, Panel, Stat, Table, Td, Tr } from "@/components/portal-ui";
import { useAsync } from "@/lib/hooks";
import {
  ApiError,
  fetchAdminPlatformFees,
  settleAllPendingFees,
  settlePlatformFees,
  type PlatformFeeDto,
} from "@/lib/api";
import { formatCents, formatDateTime } from "@/lib/format";

type StatusFilter = "ALL" | "PENDING" | "SETTLED";

function feeTone(status: string): "ok" | "warn" {
  return status === "SETTLED" ? "ok" : "warn";
}

function shortAddress(value: string): string {
  if (value.length <= 14) return value;
  return `${value.slice(0, 8)}…${value.slice(-6)}`;
}

/**
 * The operator's platform-fee ledger — SUPERADMIN only.
 *
 * These are the flat transaction fees skimmed off every inbound gateway
 * payment, routed to the operator's private wallet. Settlement is MANUAL: the
 * operator moves the funds on-chain, then marks the rows here. The platform
 * never holds a key to the destination wallet, so there is no automated sweep.
 */
export function FeesTab() {
  const { data, error, loading, reload } = useAsync(fetchAdminPlatformFees);
  const [status, setStatus] = useState<StatusFilter>("ALL");
  const [actionError, setActionError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [sweeping, setSweeping] = useState(false);

  async function settleOne(fee: PlatformFeeDto) {
    setBusyId(fee.id);
    setActionError(null);
    setOk(null);
    try {
      const { settled } = await settlePlatformFees([fee.id]);
      setOk(settled > 0 ? "Fee marked settled." : "That fee was already settled.");
      reload();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Could not settle the fee.");
    } finally {
      setBusyId(null);
    }
  }

  async function sweep() {
    setSweeping(true);
    setActionError(null);
    setOk(null);
    try {
      const { settled } = await settleAllPendingFees();
      setOk(
        settled > 0
          ? `${settled} fee${settled === 1 ? "" : "s"} marked settled.`
          : "Nothing was pending.",
      );
      reload();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Could not settle pending fees.");
    } finally {
      setSweeping(false);
    }
  }

  const rows = (data?.fees ?? []).filter((f) => status === "ALL" || f.status === status);
  const s = data?.summary;
  const pendingCount = s?.pendingCount ?? 0;

  return (
    <div className="flex flex-col gap-5">
      <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat
          label="Fees collected"
          value={loading ? "…" : formatCents(s?.totalCents ?? 0)}
          hint={loading ? undefined : `${s?.totalCount ?? 0} payments`}
        />
        <Stat
          label="Pending settlement"
          value={loading ? "…" : formatCents(s?.pendingCents ?? 0)}
          hint={loading ? undefined : `${pendingCount} awaiting`}
        />
        <Stat
          label="Settled"
          value={loading ? "…" : formatCents(s?.settledCents ?? 0)}
          hint={loading ? undefined : `${s?.settledCount ?? 0} done`}
        />
      </section>

      {error && <Note tone="error">{error}</Note>}
      {actionError && <Note tone="error">{actionError}</Note>}
      {ok && <Note tone="ok">{ok}</Note>}

      <Panel
        title="Fee ledger"
        action={
          <button
            type="button"
            disabled={sweeping || pendingCount === 0}
            onClick={() => void sweep()}
            className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1 text-[11px] font-bold text-emerald-300 transition hover:bg-emerald-400/20 disabled:opacity-40"
          >
            {sweeping ? "Settling…" : `Settle all pending${pendingCount ? ` (${pendingCount})` : ""}`}
          </button>
        }
      >
        <div className="mb-4 flex flex-wrap gap-2">
          {(["ALL", "PENDING", "SETTLED"] as const).map((o) => (
            <button
              key={o}
              type="button"
              onClick={() => setStatus(o)}
              className={`rounded-full px-3 py-1 text-[11px] font-bold transition ${
                status === o
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
          <Table columns={["Member", "Source", "Amount", "Wallet", "Status", "Created", ""]}>
            {rows.map((f) => (
              <Tr key={f.id}>
                <Td className="text-mist">{f.userEmail ?? f.userId}</Td>
                <Td>
                  <Badge tone={f.purpose === "REGISTRATION" ? "info" : "neutral"}>
                    {f.purpose === "REGISTRATION" ? "Registration" : "Deposit"}
                  </Badge>
                </Td>
                <Td className="font-semibold">{formatCents(f.amountCents)}</Td>
                <Td>
                  <span className="font-mono text-[11px] text-mist">{shortAddress(f.walletAddress)}</span>
                  <p className="mt-0.5 text-[10px] uppercase text-mist">
                    {f.asset} · {f.network}
                  </p>
                </Td>
                <Td>
                  <Badge tone={feeTone(f.status)}>{f.status}</Badge>
                  {f.settledAt && (
                    <p className="mt-0.5 text-[10px] text-mist">{formatDateTime(f.settledAt)}</p>
                  )}
                </Td>
                <Td className="whitespace-nowrap text-xs text-mist">{formatDateTime(f.createdAt)}</Td>
                <Td>
                  {f.status === "PENDING" && (
                    <button
                      type="button"
                      disabled={busyId === f.id}
                      onClick={() => void settleOne(f)}
                      className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1 text-[11px] font-bold text-emerald-300 transition hover:bg-emerald-400/20 disabled:opacity-40"
                    >
                      Mark settled
                    </button>
                  )}
                </Td>
              </Tr>
            ))}
          </Table>
        ) : (
          <Empty>No fees recorded yet.</Empty>
        )}

        <p className="mt-3 text-xs text-mist">
          Marking a fee settled records that you have moved the funds to the operator wallet by hand —
          it does not move money. Settling twice is a no-op, so a double-click cannot corrupt the
          ledger. Configure the destination wallet under <strong>Settings</strong>.
        </p>
      </Panel>
    </div>
  );
}
