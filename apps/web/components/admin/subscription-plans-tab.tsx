"use client";

import { useState } from "react";
import { ActionButton, Empty, Field, Note, Panel, Table, Td, Tr } from "@/components/portal-ui";
import { useAsync } from "@/lib/hooks";
import { ApiError, createSubscriptionPlan, fetchSubscriptionPlans, updateSubscriptionPlan, type SubscriptionPlanDto } from "@/lib/api";
import { formatCurrency } from "@/lib/format";

const selectClass = "w-full rounded-2xl border border-white/10 bg-night-2 px-4 py-3 text-[15px] text-soft outline-none transition focus:border-brand/50";

export function SubscriptionPlansTab() {
  const { data, error, loading, reload } = useAsync(fetchSubscriptionPlans);

  const [providerId, setProviderId] = useState("");
  const [name, setName] = useState("");
  const [interval, setInterval] = useState<"MONTHLY"|"6MONTH"|"YEARLY">("MONTHLY");
  const [priceCents, setPriceCents] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setOk(null);
    if (!providerId.trim() || !name.trim() || !priceCents) {
      setFormError("Provider, name and price are required.");
      return;
    }
    setBusy(true);
    try {
      const payload = {
        providerId: providerId.trim(),
        name: name.trim(),
        interval,
        priceCents: Number(priceCents),
        currency,
        isActive: true,
      };
      if (editingId) {
        await updateSubscriptionPlan(editingId, payload);
        setOk("Plan updated.");
        setEditingId(null);
      } else {
        await createSubscriptionPlan(payload);
        setOk("Plan created.");
      }
      setProviderId("");
      setName("");
      setInterval("MONTHLY");
      setPriceCents("");
      setCurrency("USD");
      reload();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Could not save plan.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <Panel title={editingId ? "Edit subscription plan" : "Create subscription plan"}>
        <form onSubmit={onSubmit} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Provider user ID" value={providerId} onChange={setProviderId} placeholder="uuid" />
          <Field label="Plan name" value={name} onChange={setName} placeholder="Premium Monthly" />
          <label className="block">
            <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-[0.12em] text-mist">Interval</span>
            <select className={selectClass} value={interval} onChange={(e) => setInterval(e.target.value as any)}>
              <option value="MONTHLY">MONTHLY</option>
              <option value="6MONTH">6MONTH</option>
              <option value="YEARLY">YEARLY</option>
            </select>
          </label>
          <Field label="Price cents" value={priceCents} onChange={setPriceCents} placeholder="5000" />
          <Field label="Currency" value={currency} onChange={setCurrency} placeholder="USD" />
          {formError && <div className="sm:col-span-2"><Note tone="error">{formError}</Note></div>}
          {ok && <div className="sm:col-span-2"><Note tone="ok">{ok}</Note></div>}
          <div className="sm:col-span-2 flex items-center gap-2">
            <ActionButton type="submit" disabled={busy}>
              {busy ? "Saving…" : editingId ? "Save changes" : "Create plan"}
            </ActionButton>
            {editingId && (
              <button type="button" onClick={() => { setEditingId(null); setProviderId(""); setName(""); setInterval("MONTHLY"); setPriceCents(""); setCurrency("USD"); }} className="rounded-full border border-white/15 bg-white/5 px-4 py-2 text-sm font-bold text-soft hover:bg-white/10">Cancel</button>
            )}
          </div>
        </form>
      </Panel>

      <Panel title="Existing plans">
        {error && <Note tone="error">{error}</Note>}
        {loading ? <Empty>Loading…</Empty> : data && data.length > 0 ? (
          <Table columns={["Provider", "Name", "Interval", "Price", "Active", ""]}>
            {data.map((p) => (
              <Tr key={p.id}>
                <Td className="font-mono text-xs">{p.providerId.slice(0,8)}…</Td>
                <Td>{p.name}</Td>
                <Td>{p.interval}</Td>
                <Td>{formatCurrency(p.priceCents, p.currency)}</Td>
                <Td>{p.isActive ? "Yes" : "No"}</Td>
                <Td>
                  <button type="button" onClick={() => { setEditingId(p.id); setProviderId(p.providerId); setName(p.name); setInterval(p.interval as any); setPriceCents(String(p.priceCents)); setCurrency(p.currency); window.scrollTo({top:0,behavior:'smooth'}); }} className="rounded-full border border-white/15 bg-white/5 px-3 py-1 text-[11px] font-bold text-soft hover:bg-white/10">Edit</button>
                </Td>
              </Tr>
            ))}
          </Table>
        ) : <Empty>No plans yet.</Empty>}
      </Panel>
    </div>
  );
}
