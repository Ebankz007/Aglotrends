"use client";

import { Badge, Empty, Note, Panel, PortalPage } from "@/components/portal-ui";
import { useAsync } from "@/lib/hooks";
import { fetchStrategies } from "@/lib/api";

export function CommunityCenter() {
  const { data, error, loading } = useAsync(fetchStrategies);

  return (
    <PortalPage title="Trader Community">
      {error && <Note tone="error">{error}</Note>}
      <Note>
        Meet the traders behind the strategies. Copying is manual — follow a trader on your own
        broker account.
      </Note>

      {loading ? (
        <Note>Loading traders…</Note>
      ) : data && data.length > 0 ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {data.map((s) => (
            <Panel key={s.id}>
              <div className="flex items-center gap-3">
                <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-gradient-to-br from-brand to-cyan text-sm font-bold text-night">
                  {s.traderName.slice(0, 2).toUpperCase()}
                </span>
                <div className="min-w-0">
                  <p className="truncate font-bold">{s.traderName}</p>
                  <p className="truncate text-xs text-mist">{s.name}</p>
                </div>
              </div>
              {s.riskLevel && (
                <div className="mt-3">
                  <Badge tone="info">{s.riskLevel} risk</Badge>
                </div>
              )}
              {s.description && <p className="mt-3 text-sm text-mist">{s.description}</p>}
            </Panel>
          ))}
        </div>
      ) : (
        <Empty>No traders listed yet.</Empty>
      )}
    </PortalPage>
  );
}
