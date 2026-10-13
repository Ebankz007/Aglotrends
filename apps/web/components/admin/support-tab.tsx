"use client";

import { useEffect, useMemo, useState } from "react";
import { ActionButton, Badge, Empty, Note, Panel, Table, Td, Tr } from "@/components/portal-ui";
import { useAsync } from "@/lib/hooks";
import {
  ApiError,
  fetchAdminTicket,
  fetchAdminTickets,
  replyToTicketAsStaff,
  setTicketStatus,
  type AdminTicketDto,
  type SupportThreadDto,
  type TicketPriority,
  type TicketStatus,
} from "@/lib/api";
import { formatDateTime } from "@/lib/format";

const STATUS_META: Record<TicketStatus, { label: string; className: string }> = {
  OPEN: { label: "Open", className: "border-amber-400/30 bg-amber-400/10 text-amber-300" },
  PENDING: { label: "Awaiting member", className: "border-brand/30 bg-brand/10 text-brand-2" },
  RESOLVED: { label: "Resolved", className: "border-emerald-400/30 bg-emerald-400/10 text-emerald-300" },
  CLOSED: { label: "Closed", className: "border-white/10 bg-white/5 text-mist" },
};

const PRIORITY_META: Record<TicketPriority, { label: string; className: string }> = {
  LOW: { label: "Low", className: "border-white/10 bg-white/5 text-mist" },
  NORMAL: { label: "Normal", className: "border-brand/30 bg-brand/10 text-brand-2" },
  HIGH: { label: "High", className: "border-amber-400/30 bg-amber-400/10 text-amber-300" },
  URGENT: { label: "Urgent", className: "border-red-400/30 bg-red-400/10 text-red-300" },
};

const FILTERS: Array<TicketStatus | "ALL"> = ["ALL", "OPEN", "PENDING", "RESOLVED", "CLOSED"];

function ThreadPanel({ id, onDone }: { id: string; onDone: () => void }) {
  const { data, error, loading } = useAsync(() => fetchAdminTicket(id));
  const [thread, setThread] = useState<SupportThreadDto | null>(null);
  const [reply, setReply] = useState("");
  const [busy, setSending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    if (data) setThread(data);
  }, [data]);

  async function send() {
    const body = reply.trim();
    if (!body) return;
    setActionError(null);
    try {
      setThread(await replyToTicketAsStaff(id, body));
      setReply("");
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Could not send the reply.");
    }
  }

  async function changeStatus(status: TicketStatus) {
    try {
      await setTicketStatus(id, status);
      setThread((prev) => (prev ? { ...prev, ticket: { ...prev.ticket, status } } : prev));
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Could not update status.");
    }
  }

  const ticket = thread?.ticket;

  return (
    <Panel
      title="Conversation"
      action={
        <button
          type="button"
          onClick={() => {
            onDone();
          }}
          className="text-xs font-bold text-mist transition hover:text-soft"
        >
          Close
        </button>
      }
    >
      {error && <Note tone="error">{error}</Note>}
      {!thread && <Empty>Loading conversation…</Empty>}

      {ticket && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge className={STATUS_META[ticket.status].className}>
              {STATUS_META[ticket.status].label}
            </Badge>
            <Badge className={PRIORITY_META[ticket.priority].className}>
              {PRIORITY_META[ticket.priority].label}
            </Badge>
            <Badge>{ticket.category}</Badge>
            <span className="ml-auto text-xs text-mist">Opened {formatDateTime(ticket.createdAt)}</span>
          </div>

          <h3 className="text-base font-bold text-soft">{ticket.subject}</h3>

          <div className="flex flex-wrap gap-2">
            {(["OPEN", "PENDING", "RESOLVED", "CLOSED"] as TicketStatus[]).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => changeStatus(s)}
                className={`rounded-full border px-3 py-1 text-xs font-bold transition ${
                  ticket.status === s
                    ? "border-brand/50 bg-brand/15 text-brand-2"
                    : "border-white/15 bg-white/5 text-mist hover:bg-white/10"
                }`}
              >
                {STATUS_META[s].label}
              </button>
            ))}
          </div>

          <div className="space-y-3">
            {thread.messages.map((m) => {
              const staff = m.authorRole === "STAFF";
              return (
                <div key={m.id} className={`flex ${staff ? "justify-end" : "justify-start"}`}>
                  <div
                    className={`max-w-[85%] rounded-2xl border px-4 py-3 ${
                      staff
                        ? "border-gold/25 bg-gold/10 text-soft"
                        : "border-white/10 bg-white/5 text-soft"
                    }`}
                  >
                    <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-mist">
                      {staff ? "Support" : "Member"} · {formatDateTime(m.createdAt)}
                    </p>
                    <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed">{m.body}</p>
                  </div>
                </div>
              );
            })}
          </div>

          {actionError && <Note tone="error">{actionError}</Note>}

          <textarea
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            rows={3}
            placeholder="Reply to the member…"
            className="w-full resize-y rounded-2xl border border-white/10 bg-night-2 px-4 py-3 text-[15px] text-soft outline-none transition focus:border-brand/50"
          />
          <ActionButton onClick={send}>{busy ? "Sending…" : "Send reply"}</ActionButton>
        </div>
      )}
    </Panel>
  );
}

export function SupportTab() {
  const { data, error, loading, reload } = useAsync(fetchAdminTickets);
  const [filter, setFilter] = useState<TicketStatus | "ALL">("ALL");
  const [openId, setOpenId] = useState<string | null>(null);

  const tickets = useMemo(
    () => (data ?? []).filter((t) => filter === "ALL" || t.status === filter),
    [data, filter],
  );

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={`rounded-full px-4 py-2 text-sm font-bold transition ${
              filter === f
                ? "bg-brand text-night"
                : "border border-white/15 bg-white/5 text-soft hover:bg-white/10"
            }`}
          >
            {f === "ALL" ? "All" : STATUS_META[f].label}
          </button>
        ))}
      </div>

      <Panel title="Support inbox">
        {error && <Note tone="error">{error}</Note>}
        {loading ? (
          <Empty>Loading…</Empty>
        ) : tickets.length > 0 ? (
          <Table columns={["Subject", "Member", "Category", "Priority", "Status", "Last activity", ""]}>
            {tickets.map((t: AdminTicketDto) => (
              <Tr key={t.id}>
                <Td className="font-semibold">{t.subject}</Td>
                <Td className="text-mist">{t.userFullName ?? t.userEmail ?? "—"}</Td>
                <Td className="text-mist">{t.category}</Td>
                <Td>
                  <Badge className={PRIORITY_META[t.priority].className}>
                    {PRIORITY_META[t.priority].label}
                  </Badge>
                </Td>
                <Td>
                  <Badge className={STATUS_META[t.status].className}>
                    {STATUS_META[t.status].label}
                  </Badge>
                </Td>
                <Td className="whitespace-nowrap text-xs text-mist">
                  {formatDateTime(t.lastMessageAt)}
                </Td>
                <Td>
                  <button
                    type="button"
                    onClick={() => setOpenId(openId === t.id ? null : t.id)}
                    className="rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs font-bold text-soft transition hover:bg-white/10"
                  >
                    {openId === t.id ? "Hide" : "Open"}
                  </button>
                </Td>
              </Tr>
            ))}
          </Table>
        ) : (
          <Empty>No tickets in this view.</Empty>
        )}
      </Panel>

      {openId && (
        <ThreadPanel
          key={openId}
          id={openId}
          onDone={() => {
            setOpenId(null);
            reload();
          }}
        />
      )}
    </div>
  );
}
