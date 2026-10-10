"use client";

import { useState } from "react";
import {
  ActionButton,
  Badge,
  Empty,
  Field,
  Note,
  Panel,
  PortalPage,
  Table,
  Td,
  Tr,
} from "@/components/portal-ui";
import { ArrowUpRightIcon } from "@/components/icons";
import { useAsync } from "@/lib/hooks";
import {
  ApiError,
  addBrokerAccount,
  fetchBrokers,
  fetchMyBrokerAccounts,
  fetchStrategies,
} from "@/lib/api";
import { formatCents, formatDateTime } from "@/lib/format";

function statusTone(s: string): "ok" | "warn" | "danger" {
  return s === "VERIFIED" ? "ok" : s === "REJECTED" ? "danger" : "warn";
}

export function BrokersCenter() {
  const { data, error, loading, reload } = useAsync(async () => {
    const [brokers, strategies, accounts] = await Promise.all([
      fetchBrokers(),
      fetchStrategies(),
      fetchMyBrokerAccounts(),
    ]);
    return { brokers, strategies, accounts };
  });

  const [brokerLinkId, setBrokerLinkId] = useState("");
  const [accountRef, setAccountRef] = useState("");
  const [funded, setFunded] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setOk(null);
    if (!brokerLinkId) {
      setFormError("Choose a broker.");
      return;
    }
    if (!accountRef.trim()) {
      setFormError("Enter your broker account number.");
      return;
    }
    setBusy(true);
    try {
      const fundedDollars = funded ? Number(funded) : 0;
      await addBrokerAccount({
        brokerLinkId,
        accountRef: accountRef.trim(),
        fundedAmountCents: Number.isFinite(fundedDollars) ? Math.round(fundedDollars * 100) : 0,
        notes: notes.trim() || undefined,
      });
      setOk("Account submitted for verification.");
      setAccountRef("");
      setFunded("");
      setNotes("");
      reload();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Could not submit the account.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <PortalPage title="Copy Trading">
      {error && <Note tone="error">{error}</Note>}

      <Note>
        Copying is executed on your broker&apos;s own platform. Aglotrends links you to partner
        brokers and records the account you trade on — it never places trades for you.
      </Note>

      <Panel title="Partner brokers">
        {loading ? (
          <Empty>Loading…</Empty>
        ) : data && data.brokers.length > 0 ? (
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {data.brokers.map((b) => (
              <li key={b.id} className="rounded-2xl border border-white/10 bg-navy-2 p-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-bold">{b.name}</span>
                  <a
                    href={b.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-xs font-bold text-brand-2 hover:underline"
                  >
                    Open <ArrowUpRightIcon className="h-3.5 w-3.5" />
                  </a>
                </div>
                {b.description && <p className="mt-1 text-sm text-mist">{b.description}</p>}
              </li>
            ))}
          </ul>
        ) : (
          <Empty>No partner brokers listed yet.</Empty>
        )}
      </Panel>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Panel title="Record a broker account">
          <form onSubmit={onSubmit} className="flex flex-col gap-4">
            <label className="block">
              <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-[0.12em] text-mist">
                Broker
              </span>
              <select
                value={brokerLinkId}
                onChange={(e) => setBrokerLinkId(e.target.value)}
                className="w-full rounded-2xl border border-white/10 bg-night-2 px-4 py-3 text-[15px] text-soft outline-none transition focus:border-brand/50"
              >
                <option value="">Select a broker…</option>
                {data?.brokers.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </label>
            <Field
              label="Account number / login"
              value={accountRef}
              onChange={setAccountRef}
              placeholder="e.g. 50213456"
            />
            <Field
              label="Funded amount (USD, optional)"
              type="number"
              value={funded}
              onChange={setFunded}
              placeholder="1000.00"
            />
            <Field label="Notes (optional)" value={notes} onChange={setNotes} placeholder="Anything we should know" />
            {formError && <Note tone="error">{formError}</Note>}
            {ok && <Note tone="ok">{ok}</Note>}
            <ActionButton type="submit" disabled={busy}>
              {busy ? "Submitting…" : "Submit account"}
            </ActionButton>
          </form>
        </Panel>

        <Panel title="My broker accounts">
          {loading ? (
            <Empty>Loading…</Empty>
          ) : data && data.accounts.length > 0 ? (
            <Table columns={["Account", "Funded", "Status", "Submitted"]}>
              {data.accounts.map((a) => (
                <Tr key={a.id}>
                  <Td className="font-mono text-xs">{a.accountRef}</Td>
                  <Td>{formatCents(a.fundedAmountCents)}</Td>
                  <Td>
                    <Badge tone={statusTone(a.status)}>{a.status}</Badge>
                  </Td>
                  <Td className="whitespace-nowrap text-xs text-mist">{formatDateTime(a.createdAt)}</Td>
                </Tr>
              ))}
            </Table>
          ) : (
            <Empty>You have not recorded a broker account yet.</Empty>
          )}
        </Panel>
      </div>

      <Panel title="Strategies to follow">
        {loading ? (
          <Empty>Loading…</Empty>
        ) : data && data.strategies.length > 0 ? (
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {data.strategies.map((s) => (
              <li key={s.id} className="rounded-2xl border border-white/10 bg-navy-2 p-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-bold">{s.name}</span>
                  {s.riskLevel && <Badge tone="info">{s.riskLevel}</Badge>}
                </div>
                <p className="mt-0.5 text-xs text-mist">by {s.traderName}</p>
                {s.description && <p className="mt-2 text-sm text-mist">{s.description}</p>}
              </li>
            ))}
          </ul>
        ) : (
          <Empty>No strategies published yet.</Empty>
        )}
      </Panel>
    </PortalPage>
  );
}
