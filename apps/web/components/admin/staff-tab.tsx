"use client";

import { Fragment, useState } from "react";
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
  fetchPermissionCatalog,
  updateAdminMember,
  updateStaff,
  type AccountStatus,
  type AdminArea,
  type PermissionCatalogDto,
  type PermissionLevel,
  type PermissionMap,
  type StaffMemberDto,
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
 * Per-area access editor. Renders from the server's catalog so the areas and
 * levels can never drift from what the API enforces.
 */
function PermissionEditor({
  staff,
  catalog,
  onDone,
}: {
  staff: StaffMemberDto;
  catalog: PermissionCatalogDto;
  onDone: () => void;
}) {
  const [perms, setPerms] = useState<PermissionMap>({ ...staff.permissions });
  const [viewOnly, setViewOnly] = useState(staff.viewOnly);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      // Drop NONE entries so the stored map stays a list of grants.
      const cleaned: PermissionMap = {};
      for (const [area, level] of Object.entries(perms)) {
        if (level && level !== "NONE") cleaned[area as AdminArea] = level;
      }
      await updateStaff(staff.id, { permissions: cleaned, viewOnly });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save permissions");
    } finally {
      setBusy(false);
    }
  }

  if (staff.role === "SUPERADMIN") {
    return (
      <div className="flex flex-col gap-3">
        <Note tone="info">
          {staff.fullName} is a SUPERADMIN and holds every area by role. Demote them to ADMIN first
          to restrict access.
        </Note>
        <div>
          <ActionButton tone="quiet" onClick={onDone}>
            Close
          </ActionButton>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <label className="flex items-start gap-3 rounded-2xl border border-white/10 bg-night-2 p-3">
        <input
          type="checkbox"
          checked={viewOnly}
          onChange={(e) => setViewOnly(e.target.checked)}
          className="mt-0.5 h-4 w-4 accent-brand"
        />
        <span>
          <span className="block text-sm font-bold text-soft">View only</span>
          <span className="block text-xs text-mist">
            Caps every granted area at VIEW. The cap never grants access — it only removes it.
          </span>
        </span>
      </label>

      <div className="flex flex-col gap-2">
        {catalog.areas.map((area) => {
          const current = perms[area.id] ?? "NONE";
          return (
            <div
              key={area.id}
              className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-night-2 p-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <p className="text-sm font-semibold text-soft">{area.label}</p>
                <p className="text-xs text-mist">{area.description}</p>
              </div>
              <div className="flex shrink-0 gap-1 rounded-xl border border-white/10 bg-night p-1">
                {catalog.levels.map((level) => (
                  <button
                    key={level}
                    type="button"
                    onClick={() => setPerms((prev) => ({ ...prev, [area.id]: level }))}
                    aria-pressed={perms[area.id] === level}
                    className={`rounded-lg px-2.5 py-1 text-[11px] font-bold transition ${
                      perms[area.id] === level
                        ? level === "MANAGE"
                          ? "bg-emerald-400/20 text-emerald-300"
                          : level === "VIEW"
                            ? "bg-brand/25 text-brand-2"
                            : "bg-white/10 text-soft"
                        : "text-mist hover:text-soft"
                    }`}
                  >
                    {level}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {error && <Note tone="error">{error}</Note>}

      <div className="flex gap-2">
        <ActionButton onClick={save} disabled={busy}>
          {busy ? "Saving…" : "Save access"}
        </ActionButton>
        <ActionButton tone="quiet" onClick={onDone} disabled={busy}>
          Cancel
        </ActionButton>
      </div>
    </div>
  );
}

/**
 * Staff management — SUPERADMIN only. Create admins, change their role, suspend
 * or reinstate them, and grant per-area access. The API enforces every one of
 * these rules; this UI simply refuses to offer a control that would 403.
 */
export function StaffTab() {
  const { data, error, loading, reload } = useAsync(fetchAdminStaff);
  const { data: me, loading: meLoading } = useAsync(fetchMe);
  const { data: catalog } = useAsync(fetchPermissionCatalog);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
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

  if (!me || !isSuperAdmin) {
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
        <p className="mt-3 text-xs text-mist">
          New staff start with no area access. Grant areas with <strong>Manage</strong>, then have
          them enrol two-factor — they cannot open the console until they do.
        </p>
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
          <Table columns={["Member", "Role", "Status", "2FA", "Last login", "Added", "Access"]}>
            {data.map((s) => (
              <Fragment key={s.id}>
                <Tr>
                  <Td>
                    <p className="font-semibold">{s.fullName}</p>
                    <p className="text-xs text-mist">{s.email}</p>
                  </Td>
                  <Td>
                    <select
                      className={selectClass}
                      value={s.role}
                      onChange={(e) => patch(s.id, { role: e.target.value as UserRole })}
                      disabled={busyId === s.id || s.id === me.id}
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
                      onChange={(e) => patch(s.id, { status: e.target.value as AccountStatus })}
                      disabled={busyId === s.id || s.id === me.id}
                    >
                      <option value="PENDING">PENDING</option>
                      <option value="ACTIVE">ACTIVE</option>
                      <option value="SUSPENDED">SUSPENDED</option>
                    </select>
                    <div className="mt-1">
                      <Badge tone={statusTone(s.status)}>{s.status}</Badge>
                    </div>
                  </Td>
                  <Td>
                    <Badge tone={s.twoFactorEnabled ? "ok" : "danger"}>
                      {s.twoFactorEnabled ? "Enabled" : "Not set"}
                    </Badge>
                    {s.viewOnly && (
                      <div className="mt-1">
                        <Badge tone="warn">View only</Badge>
                      </div>
                    )}
                  </Td>
                  <Td className="whitespace-nowrap text-xs text-mist">
                    {s.lastLoginAt ? formatDateTime(s.lastLoginAt) : "Never"}
                  </Td>
                  <Td className="whitespace-nowrap text-xs text-mist">{formatDate(s.createdAt)}</Td>
                  <Td>
                    <ActionButton
                      tone="quiet"
                      className="!min-h-0 !px-3 !py-1.5 !text-xs"
                      onClick={() => setEditingId(editingId === s.id ? null : s.id)}
                    >
                      {editingId === s.id ? "Close" : "Manage"}
                    </ActionButton>
                  </Td>
                </Tr>
                {editingId === s.id && catalog && (
                  <Tr>
                    <Td colSpan={7} className="bg-night-2/60">
                      <PermissionEditor
                        staff={s}
                        catalog={catalog}
                        onDone={() => {
                          setEditingId(null);
                          reload();
                        }}
                      />
                    </Td>
                  </Tr>
                )}
              </Fragment>
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
