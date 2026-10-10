"use client";

import { Empty, Note, Panel, PortalPage } from "@/components/portal-ui";
import { useAsync } from "@/lib/hooks";
import { fetchMyNotifications } from "@/lib/api";
import { formatDateTime } from "@/lib/format";

export function NotificationsCenter() {
  const { data, error, loading } = useAsync(fetchMyNotifications);

  return (
    <PortalPage title="Notifications">
      {error && <Note tone="error">{error}</Note>}
      <Panel>
        {loading ? (
          <Empty>Loading…</Empty>
        ) : data && data.length > 0 ? (
          <ul className="flex flex-col divide-y divide-white/5">
            {data.map((n) => (
              <li key={n.id} className="flex items-start gap-3 py-4 first:pt-0 last:pb-0">
                <span
                  className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                    n.readAt ? "bg-white/20" : "bg-brand"
                  }`}
                  aria-hidden="true"
                />
                <div className="min-w-0">
                  <p className="font-semibold">{n.title}</p>
                  {n.body && <p className="mt-0.5 text-sm text-mist">{n.body}</p>}
                  <p className="mt-1 text-[11px] text-mist">{formatDateTime(n.createdAt)}</p>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <Empty>No notifications yet.</Empty>
        )}
      </Panel>
    </PortalPage>
  );
}
