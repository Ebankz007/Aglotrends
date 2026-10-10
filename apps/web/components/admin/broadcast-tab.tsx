"use client";

import { useState } from "react";
import { ActionButton, Badge, Empty, Field, Note, Panel, Table, Td, Tr } from "@/components/portal-ui";
import { useAsync } from "@/lib/hooks";
import {
  ApiError,
  fetchBroadcasts,
  sendBroadcast,
  type BroadcastAudience,
  type BroadcastResultDto,
} from "@/lib/api";
import { formatDateTime } from "@/lib/format";

const inputClass =
  "w-full rounded-2xl border border-white/10 bg-night-2 px-4 py-3 text-[15px] text-soft outline-none transition focus:border-brand/50";

const AUDIENCES: Array<{ value: BroadcastAudience; label: string }> = [
  { value: "ALL", label: "Everyone" },
  { value: "ACTIVE", label: "Active accounts" },
  { value: "INACTIVE", label: "Unpaid / inactive members" },
  { value: "STAFF", label: "Staff only" },
];

interface BroadcastMeta {
  title?: string;
  audience?: string;
  recipients?: number;
  emailsSent?: number;
}

/**
 * Post an announcement to a slice of the user base. In-app notifications are
 * written for every recipient; email is attempted only when asked for and when
 * SMTP is configured. History is read back from the audit trail.
 */
export function BroadcastTab() {
  const { data, error, loading, reload } = useAsync(fetchBroadcasts);

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [link, setLink] = useState("");
  const [audience, setAudience] = useState<BroadcastAudience>("ALL");
  const [sendEmail, setSendEmail] = useState(false);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<BroadcastResultDto | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSending(true);
    setActionError(null);
    setResult(null);
    try {
      const res = await sendBroadcast({
        title,
        body,
        link: link.trim() ? link.trim() : null,
        audience,
        sendEmail,
      });
      setResult(res);
      setTitle("");
      setBody("");
      setLink("");
      setSendEmail(false);
      reload();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Could not send the announcement");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Panel title="New announcement">
        <form onSubmit={submit} className="flex flex-col gap-3">
          <label className="block">
            <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-[0.12em] text-mist">
              Title
            </span>
            <input
              className={inputClass}
              value={title}
              maxLength={140}
              placeholder="Scheduled maintenance this weekend"
              onChange={(e) => setTitle(e.target.value)}
              required
            />
          </label>

          <label className="block">
            <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-[0.12em] text-mist">
              Message
            </span>
            <textarea
              className={inputClass}
              rows={5}
              value={body}
              maxLength={4000}
              placeholder="Write the announcement members will see in their portal…"
              onChange={(e) => setBody(e.target.value)}
              required
            />
          </label>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-[0.12em] text-mist">
                Audience
              </span>
              <select
                className={inputClass}
                value={audience}
                onChange={(e) => setAudience(e.target.value as BroadcastAudience)}
              >
                {AUDIENCES.map((a) => (
                  <option key={a.value} value={a.value}>
                    {a.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-[0.12em] text-mist">
                Link (optional)
              </span>
              <input
                className={inputClass}
                value={link}
                maxLength={300}
                placeholder="/wallet"
                onChange={(e) => setLink(e.target.value)}
              />
            </label>
          </div>

          <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-white/10 bg-night-2 px-4 py-3">
            <input
              type="checkbox"
              checked={sendEmail}
              onChange={(e) => setSendEmail(e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-[color:var(--color-brand)]"
            />
            <span>
              <span className="block text-sm font-bold text-soft">Also send by email</span>
              <span className="mt-0.5 block text-xs text-mist">
                No-op when SMTP is not configured on the server.
              </span>
            </span>
          </label>

          <ActionButton type="submit" disabled={sending}>
            {sending ? "Sending…" : "Send announcement"}
          </ActionButton>
        </form>

        {result && (
          <div className="mt-3">
            <Note tone="ok">
              Delivered to {result.recipients} member{result.recipients === 1 ? "" : "s"}
              {result.emailsSent > 0 ? ` · ${result.emailsSent} emailed` : ""}.
            </Note>
          </div>
        )}
        {actionError && (
          <div className="mt-3">
            <Note tone="error">{actionError}</Note>
          </div>
        )}
      </Panel>

      <Panel title="History">
        {error && <Note tone="error">{error}</Note>}
        {loading ? (
          <Empty>Loading…</Empty>
        ) : data && data.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead>
                <tr className="text-[11px] uppercase tracking-[0.12em] text-mist">
                  <th className="px-3 py-2 font-semibold">Title</th>
                  <th className="px-3 py-2 font-semibold">Audience</th>
                  <th className="px-3 py-2 font-semibold">Recipients</th>
                  <th className="px-3 py-2 font-semibold">Sent</th>
                </tr>
              </thead>
              <tbody className="text-soft">
                {data.map((entry) => {
                  const meta = (entry.metadata ?? {}) as BroadcastMeta;
                  return (
                    <tr key={entry.id} className="border-t border-white/5">
                      <td className="px-3 py-3 font-semibold">{meta.title ?? "—"}</td>
                      <td className="px-3 py-3">
                        <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-0.5 text-[11px] font-bold text-mist">
                          {meta.audience ?? "—"}
                        </span>
                      </td>
                      <td className="px-3 py-3">
                        {meta.recipients ?? 0}
                        {meta.emailsSent ? (
                          <span className="ml-2 text-xs text-mist">({meta.emailsSent} emailed)</span>
                        ) : null}
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-xs text-mist">
                        {formatDateTime(entry.createdAt)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>No announcements sent yet.</Empty>
        )}
      </Panel>
    </div>
  );
}
