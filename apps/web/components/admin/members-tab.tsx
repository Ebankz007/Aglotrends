"use client";

import { useState } from "react";
import { Badge, Empty, Note, Panel, Table, Td, Tr } from "@/components/portal-ui";
import { useAsync } from "@/lib/hooks";
import {
  ApiError,
  fetchAdminMembers,
  fetchMe,
  updateAdminMember,
  type AccountStatus,
  type UserRole,
} from "@/lib/api";
import { formatDate } from "@/lib/format";

const selectClass =
  "rounded-xl border border-white/10 bg-night-2 px-2.5 py-1.5 text-xs text-soft outline-none transition focus:border-brand/50";

function roleTone(role: UserRole): "info" | "warn" | "neutral" {
  return role === "SUPERADMIN" ? "warn" : role === "ADMIN" ? "info" : "neutral";
}

function statusTone(status: AccountStatus): "ok" | "warn" | "danger" {
  return status === "ACTIVE" ? "ok" : status === "SUSPENDED" ? "danger" : "warn";
}

export function MembersTab() {
  const { data, error, loading, reload } = useAsync(fetchAdminMembers);
  const { data: me } = useAsync(fetchMe);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Only SUPERADMIN may change a role (the API enforces it); don't show an
  // ADMIN a control that will always 403.
  const isSuperAdmin = me?.role === "SUPERADMIN";

  async function patch(id: string, changes: Parameters<typeof updateAdminMember>[1]) {
    setBusyId(id);
    setActionError(null);
    try {
      await updateAdminMember(id, changes);
      reload();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Update failed.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Panel title="Members">
      {error && <Note tone="error">{error}</Note>}
      {actionError && <Note tone="error">{actionError}</Note>}
      {loading ? (
        <Empty>Loading…</Empty>
      ) : data && data.length > 0 ? (
        <Table columns={["Member", "Role", "Status", "Active", "Ranks", "Joined"]}>
          {data.map((m) => (
            <Tr key={m.id}>
              <Td>
                <span className="font-semibold">{m.fullName}</span>
                <p className="text-xs text-mist">{m.email}</p>
              </Td>
              <Td>
                {isSuperAdmin && (
                  <select
                    className={selectClass}
                    value={m.role}
                    disabled={busyId === m.id}
                    onChange={(e) => void patch(m.id, { role: e.target.value as UserRole })}
                  >
                    <option value="MEMBER">MEMBER</option>
                    <option value="ADMIN">ADMIN</option>
                    <option value="SUPERADMIN">SUPERADMIN</option>
                  </select>
                )}
                <div className={isSuperAdmin ? "mt-1" : ""}>
                  <Badge tone={roleTone(m.role)}>{m.role}</Badge>
                </div>
              </Td>
              <Td>
                <select
                  className={selectClass}
                  value={m.status}
                  disabled={busyId === m.id || me?.id === m.id}
                  onChange={(e) => void patch(m.id, { status: e.target.value as AccountStatus })}
                >
                  <option value="PENDING">PENDING</option>
                  <option value="ACTIVE">ACTIVE</option>
                  <option value="SUSPENDED">SUSPENDED</option>
                </select>
                <div className="mt-1">
                  <Badge tone={statusTone(m.status)}>{m.status}</Badge>
                </div>
              </Td>
              <Td>
                <button
                  type="button"
                  disabled={busyId === m.id}
                  onClick={() => void patch(m.id, { isActiveMember: !m.isActiveMember })}
                  className={`rounded-full px-3 py-1 text-[11px] font-bold transition ${
                    m.isActiveMember
                      ? "border border-emerald-400/30 bg-emerald-400/10 text-emerald-300"
                      : "border border-white/15 bg-white/5 text-mist"
                  }`}
                >
                  {m.isActiveMember ? "Active" : "Inactive"}
                </button>
              </Td>
              <Td className="whitespace-nowrap text-xs text-mist">
                A{m.highestAssociateRank} · L{m.highestLeadershipRank}
              </Td>
              <Td className="whitespace-nowrap text-xs text-mist">{formatDate(m.createdAt)}</Td>
            </Tr>
          ))}
        </Table>
      ) : (
        <Empty>No members yet.</Empty>
      )}
    </Panel>
  );
}
