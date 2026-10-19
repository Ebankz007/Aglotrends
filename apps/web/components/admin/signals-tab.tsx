"use client";

import { useState } from "react";
import {
  ActionButton,
  Badge,
  Empty,
  Field,
  Note,
  Panel,
  Table,
  Td,
  Tr,
} from "@/components/portal-ui";
import { useAsync } from "@/lib/hooks";
import {
  ApiError,
  createSignal,
  fetchAdminSignals,
  publishSignal,
  updateSignal,
  type SignalDto,
} from "@/lib/api";
import { formatDateTime } from "@/lib/format";

const selectClass =
  "w-full rounded-2xl border border-white/10 bg-night-2 px-4 py-3 text-[15px] text-soft outline-none transition focus:border-brand/50";

function dirTone(d: string): "ok" | "danger" | "neutral" {
  return d === "BUY" ? "ok" : d === "SELL" ? "danger" : "neutral";
}

function statusTone(s: string): "ok" | "warn" | "neutral" {
  return s === "PUBLISHED" ? "ok" : s === "CLOSED" ? "neutral" : "warn";
}

export function SignalsTab() {
  const { data, error, loading, reload } = useAsync(fetchAdminSignals);

  const [title, setTitle] = useState("");
  const [instrument, setInstrument] = useState("");
  const [direction, setDirection] = useState<SignalDto["direction"]>("BUY");
  const [entryPrice, setEntryPrice] = useState("");
  const [stopLoss, setStopLoss] = useState("");
  const [takeProfit, setTakeProfit] = useState("");
  const [timeframe, setTimeframe] = useState("");
  const [notes, setNotes] = useState("");
  const [visibility, setVisibility] = useState<'FREE'|'PREMIUM'>('FREE');
  const [chartImageUrl, setChartImageUrl] = useState("");
  const [chartLink, setChartLink] = useState("");
  const [publish, setPublish] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setOk(null);
    if (!title.trim() || !instrument.trim()) {
      setFormError("Title and instrument are required.");
      return;
    }
    setBusy(true);
    try {
      if (editingId) {
        await updateSignal(editingId, {
          title: title.trim(),
          instrument: instrument.trim(),
          direction,
          entryPrice: entryPrice.trim() || undefined,
          stopLoss: stopLoss.trim() || undefined,
          takeProfit: takeProfit.trim() || undefined,
          timeframe: timeframe.trim() || undefined,
          notes: notes.trim() || undefined,
          visibility,
          chartImageUrl: chartImageUrl.trim() || undefined,
          chartLink: chartLink.trim() || undefined,
        });
        setOk("Signal updated.");
        setEditingId(null);
      } else {
        await createSignal({
          title: title.trim(),
          instrument: instrument.trim(),
          direction,
          entryPrice: entryPrice.trim() || undefined,
          stopLoss: stopLoss.trim() || undefined,
          takeProfit: takeProfit.trim() || undefined,
          timeframe: timeframe.trim() || undefined,
          notes: notes.trim() || undefined,
          visibility,
          chartImageUrl: chartImageUrl.trim() || undefined,
          chartLink: chartLink.trim() || undefined,
          publish,
        });
        setOk(publish ? "Signal created and published." : "Signal saved as draft.");
      }
      setTitle("");
      setInstrument("");
      setEntryPrice("");
      setStopLoss("");
      setTakeProfit("");
      setTimeframe("");
      setNotes("");
      setVisibility('FREE');
      setChartImageUrl("");
      setChartLink("");
      setPublish(true);
      reload();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Could not save the signal.");
    } finally {
      setBusy(false);
    }
  }

  async function onPublish(id: string) {
    setActionError(null);
    try {
      await publishSignal(id);
      reload();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Could not publish.");
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <Panel title={editingId ? "Edit signal" : "Author a signal"}>
        <form onSubmit={onCreate} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Title" value={title} onChange={setTitle} placeholder="Breakout continuation" />
          <Field label="Instrument" value={instrument} onChange={setInstrument} placeholder="EURUSD" />
          <label className="block">
            <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-[0.12em] text-mist">
              Direction
            </span>
            <select
              className={selectClass}
              value={direction}
              onChange={(e) => setDirection(e.target.value as SignalDto["direction"])}
            >
              <option value="BUY">BUY</option>
              <option value="SELL">SELL</option>
              <option value="NEUTRAL">NEUTRAL</option>
            </select>
          </label>
          <Field label="Timeframe (optional)" value={timeframe} onChange={setTimeframe} placeholder="H4" />
          <Field label="Entry (optional)" value={entryPrice} onChange={setEntryPrice} placeholder="1.0842" />
          <Field label="Stop loss (optional)" value={stopLoss} onChange={setStopLoss} placeholder="1.0800" />
          <Field label="Take profit (optional)" value={takeProfit} onChange={setTakeProfit} placeholder="1.0950" />
          <label className="block sm:col-span-2">
            <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-[0.12em] text-mist">Visibility</span>
            <select className={selectClass} value={visibility} onChange={(e) => setVisibility(e.target.value as 'FREE'|'PREMIUM')}>
              <option value="FREE">FREE</option>
              <option value="PREMIUM">PREMIUM</option>
            </select>
          </label>
          <Field label="Chart image URL (optional)" value={chartImageUrl} onChange={setChartImageUrl} placeholder="https://..." />
          <Field label="Chart link (optional)" value={chartLink} onChange={setChartLink} placeholder="https://tradingview.com/..." />
          <div className="sm:col-span-2">
            <Field label="Notes (optional)" value={notes} onChange={setNotes} placeholder="Rationale, context" />
          </div>
          {!editingId && (
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <input
                type="checkbox"
                checked={publish}
                onChange={(e) => setPublish(e.target.checked)}
                className="h-4 w-4 accent-[var(--color-brand)]"
              />
              Publish immediately (delivers to members&apos; enabled channels)
            </label>
          )}
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
          <div className="sm:col-span-2 flex items-center gap-2">
            <ActionButton type="submit" disabled={busy}>
              {busy ? "Saving…" : editingId ? "Save changes" : "Create signal"}
            </ActionButton>
            {editingId && (
              <button
                type="button"
                onClick={() => {
                  setEditingId(null);
                  setTitle("");
                  setInstrument("");
                  setDirection("BUY");
                  setEntryPrice("");
                  setStopLoss("");
                  setTakeProfit("");
                  setTimeframe("");
                  setNotes("");
                  setVisibility('FREE');
                  setChartImageUrl("");
                  setChartLink("");
                  setPublish(true);
                }}
                className="rounded-full border border-white/15 bg-white/5 px-4 py-2 text-sm font-bold text-soft hover:bg-white/10"
              >
                Cancel
              </button>
            )}
          </div>
        </form>
      </Panel>

      <Panel title="All signals">
        {actionError && <Note tone="error">{actionError}</Note>}
        {error && <Note tone="error">{error}</Note>}
        {loading ? (
          <Empty>Loading…</Empty>
        ) : data && data.length > 0 ? (
          <Table columns={["Instrument", "Title", "Direction", "Status", "Created", ""]}>
            {data.map((s) => (
              <Tr key={s.id}>
                <Td className="font-semibold">{s.instrument}</Td>
                <Td>{s.title}</Td>
                <Td>
                  <Badge tone={dirTone(s.direction)}>{s.direction}</Badge>
                </Td>
                <Td>
                  <Badge tone={statusTone(s.status)}>{s.status}</Badge>
                </Td>
                <Td className="whitespace-nowrap text-xs text-mist">{formatDateTime(s.createdAt)}</Td>
                <Td className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setEditingId(s.id);
                      setTitle(s.title);
                      setInstrument(s.instrument);
                      setDirection(s.direction);
                      setEntryPrice(s.entryPrice ?? "");
                      setStopLoss(s.stopLoss ?? "");
                      setTakeProfit(s.takeProfit ?? "");
                      setTimeframe(s.timeframe ?? "");
                      setNotes(s.notes ?? "");
                      setVisibility((s as any).visibility ?? 'FREE');
                      setChartImageUrl((s as any).chartImageUrl ?? "");
                      setChartLink((s as any).chartLink ?? "");
                      window.scrollTo({ top: 0, behavior: 'smooth' });
                    }}
                    className="rounded-full border border-white/15 bg-white/5 px-3 py-1 text-[11px] font-bold text-soft transition hover:bg-white/10"
                  >
                    Edit
                  </button>
                  {s.status === "DRAFT" && (
                    <button
                      type="button"
                      onClick={() => void onPublish(s.id)}
                      className="rounded-full border border-brand/30 bg-brand/10 px-3 py-1 text-[11px] font-bold text-brand-2 transition hover:bg-brand/20"
                    >
                      Publish
                    </button>
                  )}
                </Td>
              </Tr>
            ))}
          </Table>
        ) : (
          <Empty>No signals yet.</Empty>
        )}
      </Panel>
    </div>
  );
}
