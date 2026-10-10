"use client";

import { Empty, Note, Panel, Table, Td, Tr } from "@/components/portal-ui";
import { useAsync } from "@/lib/hooks";
import { fetchAuditLog } from "@/lib/api";
import { formatDateTime } from "@/lib/format";

export function AuditTab() {
  const { data, error, loading } = useAsync(fetchAuditLog);

  return (
    <Panel title="Audit log">
      {error && <Note tone="error">{error}</Note>}
      {loading ? (
        <Empty>Loading…</Empty>
      ) : data && data.length > 0 ? (
        <Table columns={["Action", "Target", "Actor", "When"]}>
          {data.map((e) => (
            <Tr key={e.id}>
              <Td className="font-semibold">{e.action}</Td>
              <Td className="text-xs text-mist">
                {e.targetType ?? "—"}
                {e.targetId ? ` · ${e.targetId.slice(0, 8)}` : ""}
              </Td>
              <Td className="font-mono text-xs">{e.actorId ? e.actorId.slice(0, 8) : "system"}</Td>
              <Td className="whitespace-nowrap text-xs text-mist">{formatDateTime(e.createdAt)}</Td>
            </Tr>
          ))}
        </Table>
      ) : (
        <Empty>No audit entries yet.</Empty>
      )}
    </Panel>
  );
}
