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
  createStaff,
  fetchAdminStaff,
  fetchMe,
  updateAdminMember,
  type AccountStatus,
  type UserRole,
} from "@/lib/api";
import { formatDate, formatDateTime } from "@/lib/format";

const selectClass =
  "rounded-xl border border-white/10 bg-night-2 px-2.5 py-1.5 text-xs text-soft outline-none transition focus:border-brand/50";

function roleTone(role: UserRole): "info" | "warn" | "neutral" {
  return role === "SUPERADMIN" ? "warn" : role === "ADMIN" ? "info" : "neutral";
}

function statusTone(status: AccountStatus): "ok" | "warn" | "danger" {
  return status === "ACTIVE" ? "ok" : status === "SUSPENDED" ? "danger" : "warn";
}

/**
 * Staff management — SUPERADMIN only. Create admins, change their role, and
 * suspend or reinstate them. The API enforces every one of these rules; this
 * UI simply refuses to offer a control that would 403.
 */
export function StaffTab() {
  const { data, error, loading, reload } = useAsync(fetchAdminStaff);
  const { data: me, loading: meLoading } = useAsync(fetchMe);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"ADMIN" | "SUPERADMIN">("ADMIN");
  const [creating, setCreating] = useState(false);
  const [createdNote, setCreatedNote] = useState<string | null>(null);

  const isSuperAdmin = me?.role === "SUPERADMIN";

  async function patch(id: string, changes: Parameters<typeof updateAdminMember>[1]) {
    setBusyId(id);
    setActionError(null);
    try {
      await updateAdminMember(id, changes);
      reload();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Could not update staff member");
    } finally {
      setBusyId(null);
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setCreating(true);
    setActionError(null);
    setCreatedNote(null);
    try {
      const staff = await createStaff({ email, fullName, password, role });
      setCreatedNote(`${staff.email} provisioned as ${staff.role}.`);
      setEmail("");
      setFullName("");
      setPassword("");
      setRole("ADMIN");
      reload();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Could not create staff account");
    } finally {
      setCreating(false);
    }
  }

  if (meLoading) {
    return (
      <Panel title="Staff">
        <Empty>Loading…</Empty>
      </Panel>
    );
  }

  if (!isSuperAdmin) {
    return (
      <Panel title="Staff">
        <Note tone="info">
          Only a SUPERADMIN can add or manage staff accounts. Ask a SUPERADMIN to make the change.
        </Note>
      </Panel>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Panel title="Add a staff account">
        <form onSubmit={submit} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field
            label="Full name"
            value={fullName}
            onChange={setFullName}
            placeholder="Jane Operator"
            required
          />
          <Field
            label="Email"
            type="email"
            value={email}
            onChange={setEmail}
            placeholder="jane@aglotrends.com"
            autoComplete="off"
            required
          />
          <Field
            label="Temporary password"
            type="password"
            value={password}
            onChange={setPassword}
            placeholder="At least 8 characters"
            autoComplete="new-password"
            required
          />
          <label className="block">
            <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-[0.12em] text-mist">
              Role
            </span>
            <select
              className="w-full rounded-2xl border border-white/10 bg-night-2 px-4 py-3 text-[15px] text-soft outline-none transition focus:border-brand/50"
              value={role}
              onChange={(e) => setRole(e.target.value as "ADMIN" | "SUPERADMIN")}
            >
              <option value="ADMIN">ADMIN — runs the console</option>
              <option value="SUPERADMIN">SUPERADMIN — full control</option>
            </select>
          </label>
          <div className="sm:col-span-2">
            <ActionButton type="submit" disabled={creating}>
              {creating ? "Creating…" : "Create staff account"}
            </ActionButton>
          </div>
        </form>
        {createdNote && (
          <div className="mt-3">
            <Note tone="ok">{createdNote}</Note>
          </div>
        )}
        {actionError && (
          <div className="mt-3">
            <Note tone="error">{actionError}</Note>
          </div>
        )}
      </Panel>

      <Panel title="Staff">
        {error && <Note tone="error">{error}</Note>}
        {loading ? (
          <Empty>Loading…</Empty>
        ) : data && data.length > 0 ? (
          <Table columns={["Member", "Role", "Status", "Last login", "Added"]}>
            {data.map((s) => (
              <Tr key={s.id}>
                <Td>
                  <p className="font-semibold">{s.fullName}</p>
                  <p className="text-xs text-mist">{s.email}</p>
                </Td>
                <Td>
                  <select
                    className={selectClass}
                    value={s.role}
                    disabled={busyId === s.id || me?.id === s.id}
                    onChange={(e) => void patch(s.id, { role: e.target.value as UserRole })}
                  >
                    <option value="ADMIN">ADMIN</option>
                    <option value="SUPERADMIN">SUPERADMIN</option>
                  </select>
                  <div className="mt-1">
                    <Badge tone={roleTone(s.role)}>{s.role}</Badge>
                  </div>
                </Td>
                <Td>
                  <select
                    className={selectClass}
                    value={s.status}
                    disabled={busyId === s.id || me?.id === s.id}
                    onChange={(e) => void patch(s.id, { status: e.target.value as AccountStatus })}
                  >
                    <option value="PENDING">PENDING</option>
                    <option value="ACTIVE">ACTIVE</option>
                    <option value="SUSPENDED">SUSPENDED</option>
                  </select>
                  <div className="mt-1">
                    <Badge tone={statusTone(s.status)}>{s.status}</Badge>
                  </div>
                </Td>
                <Td className="whitespace-nowrap text-xs text-mist">
                  {s.lastLoginAt ? formatDateTime(s.lastLoginAt) : "Never"}
                </Td>
                <Td className="whitespace-nowrap text-xs text-mist">{formatDate(s.createdAt)}</Td>
              </Tr>
            ))}
          </Table>
        ) : (
          <Empty>No staff accounts yet.</Empty>
        )}
        <p className="mt-3 text-xs text-mist">
          You cannot change your own role or suspend yourself, and the platform will never let its
          last active SUPERADMIN be demoted or suspended.
        </p>
      </Panel>
    </div>
  );
}
