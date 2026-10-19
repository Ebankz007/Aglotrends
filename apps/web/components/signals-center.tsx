"use client";

import { Badge, Empty, Note, Panel, PortalPage } from "@/components/portal-ui";
import { useAsync } from "@/lib/hooks";
import { fetchSignals } from "@/lib/api";
import { formatDateTime } from "@/lib/format";

function dirTone(d: string): "ok" | "danger" | "neutral" {
  return d === "BUY" ? "ok" : d === "SELL" ? "danger" : "neutral";
}

export function SignalsCenter() {
  const { data, error, loading } = useAsync(fetchSignals);

  const isTeaser = (s: any) => s.teaser === true || s.visibility === 'PREMIUM' && !s.entryPrice;

  return (
    <PortalPage title="Signals">
      {error && <Note tone="error">{error}</Note>}
      {loading ? (
        <Note>Loading signals…</Note>
      ) : data && data.length > 0 ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {data.map((s) => {
            const teaser = isTeaser(s);
            return (
            <Panel key={s.id}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-bold">{s.instrument}</h2>
                  <p className="text-sm text-mist">{s.title}</p>
                </div>
                <div className="flex items-center gap-2">
                  {s.visibility === 'PREMIUM' && <Badge tone="neutral">PREMIUM</Badge>}
                  {!teaser && <Badge tone={dirTone(s.direction)}>{s.direction}</Badge>}
                </div>
              </div>

              {teaser ? (
                <div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm">
                  <p className="font-semibold text-amber-200">Premium signal locked</p>
                  <p className="mt-1 text-mist">Subscribe to this provider to view entry, stop, target and notes.</p>
                </div>
              ) : (
                <>
                  <dl className="mt-4 grid grid-cols-3 gap-3 text-sm">
                    <div className="rounded-xl border border-white/10 bg-night-2 p-3">
                      <dt className="text-[11px] uppercase tracking-[0.12em] text-mist">Entry</dt>
                      <dd className="mt-0.5 font-semibold">{s.entryPrice ?? "—"}</dd>
                    </div>
                    <div className="rounded-xl border border-white/10 bg-night-2 p-3">
                      <dt className="text-[11px] uppercase tracking-[0.12em] text-mist">Stop</dt>
                      <dd className="mt-0.5 font-semibold text-red-300">{s.stopLoss ?? "—"}</dd>
                    </div>
                    <div className="rounded-xl border border-white/10 bg-night-2 p-3">
                      <dt className="text-[11px] uppercase tracking-[0.12em] text-mist">Target</dt>
                      <dd className="mt-0.5 font-semibold text-emerald-300">{s.takeProfit ?? "—"}</dd>
                    </div>
                  </dl>

                  {s.notes && <p className="mt-3 text-sm text-mist">{s.notes}</p>}
                </>
              )}

              <p className="mt-3 text-[11px] text-mist">
                {s.timeframe ? `${s.timeframe} · ` : ""}
                Published {formatDateTime(s.publishedAt)}
              </p>
            </Panel>
          )})}
        </div>
      ) : (
        <Empty>No published signals yet. Check back soon.</Empty>
      )}
    </PortalPage>
  );
}
