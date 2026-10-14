"use client";

import { useState } from "react";
import { Badge, Empty, Note, Panel, Table, Td, Tr } from "@/components/portal-ui";
import { useAsync } from "@/lib/hooks";
import {
  ApiError,
  fetchAdminMembers,
  fetchMe,
  moveMemberSponsor,
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
  const [moveId, setMoveId] = useState<string | null>(null);
  const [moveCode, setMoveCode] = useState("");
  const [moveNote, setMoveNote] = useState<string | null>(null);

  // Only SUPERADMIN may change a role (the API enforces it); don't show an
  // ADMIN a control that will always 403.
  const isSuperAdmin = me?.role === "SUPERADMIN";

  async function move(id: string) {
    const sponsorCode = moveCode.trim().toUpperCase();
    if (!sponsorCode) {
      setActionError("Enter the new sponsor's referral code.");
      return;
    }
    setBusyId(id);
    setActionError(null);
    setMoveNote(null);
    try {
      const result = await moveMemberSponsor(id, sponsorCode);
      setMoveNote(result.note);
      setMoveId(null);
      setMoveCode("");
      reload();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Move failed.");
    } finally {
      setBusyId(null);
    }
  }

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
      {moveNote && <Note tone="ok">{moveNote}</Note>}
      {loading ? (
        <Empty>Loading…</Empty>
      ) : data && data.length > 0 ? (
        <Table columns={["Member", "Role", "Status", "Sponsor", "Active", "Ranks", "Joined"]}>
          {data.map((m) => (
            <Tr key={m.id}>
              <Td>
                <span className="font-semibold">{m.fullName}</span>
                <p className="text-xs text-mist">{m.email}</p>
                {m.referralCode && (
                  <p className="mt-0.5 font-mono text-[11px] font-bold text-gold-2">{m.referralCode}</p>
                )}
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
                {moveId === m.id ? (
                  <span className="flex flex-col gap-1.5">
                    <input
                      className="w-44 rounded-xl border border-white/10 bg-night-2 px-2.5 py-1.5 font-mono text-xs text-soft uppercase outline-none transition focus:border-brand/50"
                      placeholder="NEW CODE"
                      value={moveCode}
                      disabled={busyId === m.id}
                      onChange={(e) => setMoveCode(e.target.value)}
                    />
                    <span className="flex gap-1.5">
                      <button
                        type="button"
                        disabled={busyId === m.id}
                        onClick={() => void move(m.id)}
                        className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1 text-[11px] font-bold text-emerald-300 transition hover:bg-emerald-400/20 disabled:opacity-40"
                      >
                        Confirm
                      </button>
                      <button
                        type="button"
                        disabled={busyId === m.id}
                        onClick={() => {
                          setMoveId(null);
                          setMoveCode("");
                        }}
                        className="rounded-full border border-white/15 bg-white/5 px-3 py-1 text-[11px] font-bold text-mist transition hover:bg-white/10 disabled:opacity-40"
                      >
                        Cancel
                      </button>
                    </span>
                  </span>
                ) : (
                  <span className="flex flex-col gap-1">
                    <span
                      className="max-w-44 truncate font-mono text-xs font-bold text-soft"
                      title={m.sponsorEmail ?? ""}
                    >
                      {m.sponsorCode ?? "—"}
                    </span>
                    <span className="max-w-44 truncate text-[11px] text-mist" title={m.sponsorEmail ?? ""}>
                      {m.sponsorEmail ?? ""}
                    </span>
                    {m.role === "MEMBER" && (
                      <button
                        type="button"
                        disabled={busyId === m.id}
                        onClick={() => {
                          setMoveId(m.id);
                          setMoveCode("");
                          setMoveNote(null);
                        }}
                        className="w-fit rounded-full border border-white/15 bg-white/5 px-3 py-1 text-[11px] font-bold text-soft transition hover:bg-white/10 disabled:opacity-40"
                      >
                        Move
                      </button>
                    )}
                  </span>
                )}
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
