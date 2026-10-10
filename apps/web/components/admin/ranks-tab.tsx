"use client";

import { useState } from "react";
import { ActionButton, Badge, Empty, Note, Panel, Table, Td, Tr } from "@/components/portal-ui";
import { useAsync } from "@/lib/hooks";
import { ApiError, fetchRankAwards, runRankEvaluation } from "@/lib/api";
import { formatCents, formatDateTime } from "@/lib/format";

function awardTone(status: string): "ok" | "warn" | "danger" | "info" {
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

export function RanksTab() {
  const { data, error, loading, reload } = useAsync(fetchRankAwards);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [runError, setRunError] = useState<string | null>(null);

  async function onEvaluate() {
    setBusy(true);
    setRunError(null);
    setResult(null);
    try {
      const res = await runRankEvaluation();
      setResult(JSON.stringify(res, null, 2));
      reload();
    } catch (err) {
      setRunError(err instanceof ApiError ? err.message : "Evaluation failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <Panel title="Rank evaluation">
        <p className="text-sm text-mist">
          Recomputes every member&apos;s Associate and Leadership ranks from the network. Associate
          rewards are paid from the Rank pool when it is funded, or flagged when it is not.
        </p>
        <div className="mt-4 max-w-xs">
          <ActionButton onClick={() => void onEvaluate()} disabled={busy}>
            {busy ? "Evaluating…" : "Run evaluation"}
          </ActionButton>
        </div>
        {runError && (
          <div className="mt-4">
            <Note tone="error">{runError}</Note>
          </div>
        )}
        {result && (
          <pre className="mt-4 max-h-72 overflow-auto rounded-2xl border border-white/10 bg-night-2 p-4 text-xs text-mist">
            {result}
          </pre>
        )}
      </Panel>

      <Panel title="Rank awards">
        {error && <Note tone="error">{error}</Note>}
        {loading ? (
          <Empty>Loading…</Empty>
        ) : data && data.length > 0 ? (
          <Table columns={["Member", "Kind", "Rank", "Reward", "Status", "When"]}>
            {data.map((a) => (
              <Tr key={a.id}>
                <Td className="font-mono text-xs">{a.userId.slice(0, 8)}</Td>
                <Td className="font-semibold">{a.kind}</Td>
                <Td>{a.rankId}</Td>
                <Td>{a.rewardCents != null ? formatCents(a.rewardCents) : (a.rewardSku ?? "—")}</Td>
                <Td>
                  <Badge tone={awardTone(a.status)}>{a.status}</Badge>
                </Td>
                <Td className="whitespace-nowrap text-xs text-mist">{formatDateTime(a.createdAt)}</Td>
              </Tr>
            ))}
          </Table>
        ) : (
          <Empty>No rank awards yet.</Empty>
        )}
      </Panel>
    </div>
  );
}
