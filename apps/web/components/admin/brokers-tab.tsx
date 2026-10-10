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
  createBrokerLink,
  deactivateBrokerLink,
  fetchAdminBrokerAccounts,
  fetchAdminBrokerLinks,
  verifyBrokerAccount,
} from "@/lib/api";
import { formatCents, formatDateTime } from "@/lib/format";

export function BrokersTab() {
  const links = useAsync(fetchAdminBrokerLinks);
  const accounts = useAsync(fetchAdminBrokerAccounts);

  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setOk(null);
    if (!name.trim() || !url.trim()) {
      setFormError("Name and URL are required.");
      return;
    }
    setBusy(true);
    try {
      await createBrokerLink({
        name: name.trim(),
        url: url.trim(),
        description: description.trim() || undefined,
      });
      setOk("Broker link added.");
      setName("");
      setUrl("");
      setDescription("");
      links.reload();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Could not add the broker link.");
    } finally {
      setBusy(false);
    }
  }

  async function onDeactivate(id: string) {
    setActionError(null);
    try {
      await deactivateBrokerLink(id);
      links.reload();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Could not deactivate.");
    }
  }

  async function onVerify(id: string, status: "VERIFIED" | "REJECTED") {
    setActionError(null);
    try {
      await verifyBrokerAccount(id, status);
      accounts.reload();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Could not update the account.");
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Panel title="Add a broker link">
          <form onSubmit={onCreate} className="flex flex-col gap-4">
            <Field label="Broker name" value={name} onChange={setName} placeholder="e.g. Exness" />
            <Field label="Referral URL" value={url} onChange={setUrl} placeholder="https://..." />
            <Field
              label="Description (optional)"
              value={description}
              onChange={setDescription}
              placeholder="Short note for members"
            />
            {formError && <Note tone="error">{formError}</Note>}
            {ok && <Note tone="ok">{ok}</Note>}
            <ActionButton type="submit" disabled={busy}>
              {busy ? "Adding…" : "Add broker link"}
            </ActionButton>
          </form>
        </Panel>

        <Panel title="Broker links">
          {links.error && <Note tone="error">{links.error}</Note>}
          {links.loading ? (
            <Empty>Loading…</Empty>
          ) : links.data && links.data.length > 0 ? (
            <Table columns={["Name", "URL", "Active", ""]}>
              {links.data.map((b) => (
                <Tr key={b.id}>
                  <Td className="font-semibold">{b.name}</Td>
                  <Td>
                    <a
                      href={b.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-brand-2 hover:underline"
                    >
                      {b.url}
                    </a>
                  </Td>
                  <Td>
                    <Badge tone={b.isActive ? "ok" : "neutral"}>{b.isActive ? "Active" : "Off"}</Badge>
                  </Td>
                  <Td>
                    {b.isActive && (
                      <button
                        type="button"
                        onClick={() => void onDeactivate(b.id)}
                        className="rounded-full border border-red-400/40 bg-red-400/10 px-3 py-1 text-[11px] font-bold text-red-300 transition hover:bg-red-400/20"
                      >
                        Deactivate
                      </button>
                    )}
                  </Td>
                </Tr>
              ))}
            </Table>
          ) : (
            <Empty>No broker links yet.</Empty>
          )}
        </Panel>
      </div>

      <Panel title="Client broker accounts">
        {actionError && <Note tone="error">{actionError}</Note>}
        {accounts.error && <Note tone="error">{accounts.error}</Note>}
        {accounts.loading ? (
          <Empty>Loading…</Empty>
        ) : accounts.data && accounts.data.length > 0 ? (
          <Table columns={["Account", "Funded", "Status", "Submitted", ""]}>
            {accounts.data.map((a) => (
              <Tr key={a.id}>
                <Td className="font-mono text-xs">{a.accountRef}</Td>
                <Td>{formatCents(a.fundedAmountCents)}</Td>
                <Td>
                  <Badge
                    tone={a.status === "VERIFIED" ? "ok" : a.status === "REJECTED" ? "danger" : "warn"}
                  >
                    {a.status}
                  </Badge>
                </Td>
                <Td className="whitespace-nowrap text-xs text-mist">{formatDateTime(a.createdAt)}</Td>
                <Td>
                  {a.status === "PENDING" && (
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => void onVerify(a.id, "VERIFIED")}
                        className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1 text-[11px] font-bold text-emerald-300 transition hover:bg-emerald-400/20"
                      >
                        Verify
                      </button>
                      <button
                        type="button"
                        onClick={() => void onVerify(a.id, "REJECTED")}
                        className="rounded-full border border-red-400/40 bg-red-400/10 px-3 py-1 text-[11px] font-bold text-red-300 transition hover:bg-red-400/20"
                      >
                        Reject
                      </button>
                    </div>
                  )}
                </Td>
              </Tr>
            ))}
          </Table>
        ) : (
          <Empty>No client broker accounts yet.</Empty>
        )}
      </Panel>
    </div>
  );
}
