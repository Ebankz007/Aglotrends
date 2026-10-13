"use client";

import { useEffect, useState } from "react";
import { useAsync } from "@/lib/hooks";
import {
  createTicket,
  fetchMyTicket,
  fetchMyTickets,
  replyToTicket,
  type SupportThreadDto,
  type SupportTicketDto,
  type TicketPriority,
  type TicketStatus,
} from "@/lib/api";
import { PortalPage, Empty, Note, Badge, Field, ActionButton } from "@/components/portal-ui";
import { ChevronLeftIcon, LifebuoyIcon, PlusIcon } from "@/components/icons";

const STATUS_META: Record<TicketStatus, { label: string; className: string }> = {
  OPEN: { label: "Open", className: "border-amber-400/30 bg-amber-400/10 text-amber-300" },
  PENDING: { label: "Awaiting you", className: "border-brand/30 bg-brand/10 text-brand-2" },
  RESOLVED: { label: "Resolved", className: "border-emerald-400/30 bg-emerald-400/10 text-emerald-300" },
  CLOSED: { label: "Closed", className: "border-white/10 bg-white/5 text-mist" },
};

const PRIORITY_META: Record<TicketPriority, { label: string; className: string }> = {
  LOW: { label: "Low", className: "border-white/10 bg-white/5 text-mist" },
  NORMAL: { label: "Normal", className: "border-brand/30 bg-brand/10 text-brand-2" },
  HIGH: { label: "High", className: "border-amber-400/30 bg-amber-400/10 text-amber-300" },
  URGENT: { label: "Urgent", className: "border-red-400/30 bg-red-400/10 text-red-300" },
};

const CATEGORIES = ["General", "Account", "Deposits", "Withdrawals", "KYC", "Network", "Technical"];

function fmtWhen(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function TicketThread({ id, onBack }: { id: string; onBack: () => void }) {
  const { data, error, loading } = useAsync(() => fetchMyTicket(id));
  const [thread, setThread] = useState<SupportThreadDto | null>(null);
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  useEffect(() => {
    if (data) setThread(data);
  }, [data]);

  async function send() {
    const body = reply.trim();
    if (!body || sending) return;
    setSending(true);
    setSendError(null);
    try {
      setThread(await replyToTicket(id, body));
      setReply("");
    } catch (e) {
      setSendError(e instanceof Error ? e.message : "Failed to send");
    } finally {
      setSending(false);
    }
  }

  const ticket = thread?.ticket;
  const closed = ticket?.status === "CLOSED";

  return (
    <PortalPage title="Ticket" backHref="/support" backLabel="Back to support">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex w-fit items-center gap-1.5 text-xs font-bold text-mist transition hover:text-soft"
      >
        <ChevronLeftIcon className="h-4 w-4" /> All tickets
      </button>

      {error && <Note tone="error">{error}</Note>}
      {loading && !thread && <Empty>Loading conversation…</Empty>}

      {ticket && (
        <>
          <section className="surface gold-top p-5">
            <div className="flex flex-wrap items-center gap-2">
              <Badge className={STATUS_META[ticket.status].className}>
                {STATUS_META[ticket.status].label}
              </Badge>
              <Badge className={PRIORITY_META[ticket.priority].className}>
                {PRIORITY_META[ticket.priority].label}
              </Badge>
              <Badge>{ticket.category}</Badge>
            </div>
            <h2 className="mt-3 text-lg font-bold tracking-tight text-soft">{ticket.subject}</h2>
            <p className="mt-1 text-xs text-mist">Opened {fmtWhen(ticket.createdAt)}</p>
          </section>

          <section className="space-y-3">
            {thread?.messages.map((m) => {
              const staff = m.authorRole === "STAFF";
              return (
                <div
                  key={m.id}
                  className={`flex ${staff ? "justify-start" : "justify-end"}`}
                >
                  <div
                    className={`max-w-[85%] rounded-2xl border px-4 py-3 ${
                      staff
                        ? "border-gold/25 bg-gold/10 text-soft"
                        : "border-brand/25 bg-brand/10 text-soft"
                    }`}
                  >
                    <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-mist">
                      {staff ? "Support" : "You"} · {fmtWhen(m.createdAt)}
                    </p>
                    <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed">{m.body}</p>
                  </div>
                </div>
              );
            })}
          </section>

          {closed ? (
            <Note tone="info">
              This ticket is closed. Open a new ticket if you need more help.
            </Note>
          ) : (
            <section className="surface p-4">
              {sendError && <Note tone="error">{sendError}</Note>}
              <textarea
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                rows={3}
                placeholder="Write a reply…"
                className="w-full resize-y rounded-2xl border border-white/10 bg-night-2 px-4 py-3 text-[15px] text-soft outline-none transition focus:border-gold/50"
              />
              <div className="mt-3">
                <ActionButton onClick={send} className="!bg-gradient-to-r !from-gold-2 !to-gold !text-night">
                  {sending ? "Sending…" : "Send reply"}
                </ActionButton>
              </div>
            </section>
          )}
        </>
      )}
    </PortalPage>
  );
}

function NewTicket({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const [subject, setSubject] = useState("");
  const [category, setCategory] = useState(CATEGORIES[0]!);
  const [priority, setPriority] = useState<TicketPriority>("NORMAL");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (busy) return;
    if (!subject.trim() || !message.trim()) {
      setError("Subject and message are required.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await createTicket({ subject: subject.trim(), category, priority, message: message.trim() });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create ticket");
    } finally {
      setBusy(false);
    }
  }

  return (
    <PortalPage title="New ticket" backHref="/support" backLabel="Back to support">
      <button
        type="button"
        onClick={onCancel}
        className="inline-flex w-fit items-center gap-1.5 text-xs font-bold text-mist transition hover:text-soft"
      >
        <ChevronLeftIcon className="h-4 w-4" /> All tickets
      </button>

      <section className="surface gold-top space-y-4 p-5">
        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-gold-2">
          Tell us what you need
        </p>
        {error && <Note tone="error">{error}</Note>}

        <Field label="Subject" value={subject} onChange={setSubject} placeholder="Short summary" />

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-[0.12em] text-mist">
              Category
            </span>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full rounded-2xl border border-white/10 bg-night-2 px-4 py-3 text-[15px] text-soft outline-none transition focus:border-gold/50"
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-[0.12em] text-mist">
              Priority
            </span>
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value as TicketPriority)}
              className="w-full rounded-2xl border border-white/10 bg-night-2 px-4 py-3 text-[15px] text-soft outline-none transition focus:border-gold/50"
            >
              {(Object.keys(PRIORITY_META) as TicketPriority[]).map((p) => (
                <option key={p} value={p}>
                  {PRIORITY_META[p].label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="block">
          <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-[0.12em] text-mist">
            Message
          </span>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={5}
            placeholder="Describe the issue in detail…"
            className="w-full resize-y rounded-2xl border border-white/10 bg-night-2 px-4 py-3 text-[15px] text-soft outline-none transition focus:border-gold/50"
          />
        </label>

        <ActionButton
          onClick={submit}
          className="!bg-gradient-to-r !from-gold-2 !to-gold !text-night"
        >
          {busy ? "Submitting…" : "Submit ticket"}
        </ActionButton>
      </section>
    </PortalPage>
  );
}

export function SupportCenter() {
  const { data, error, loading, reload } = useAsync(fetchMyTickets);
  const [mode, setMode] = useState<"list" | "new">("list");
  const [openId, setOpenId] = useState<string | null>(null);

  if (openId) {
    return (
      <TicketThread
        id={openId}
        onBack={() => {
          setOpenId(null);
          reload();
        }}
      />
    );
  }

  if (mode === "new") {
    return (
      <NewTicket
        onCancel={() => setMode("list")}
        onDone={() => {
          setMode("list");
          reload();
        }}
      />
    );
  }

  const tickets = data ?? [];

  return (
    <PortalPage title="Support">
      <section className="surface p-5">
        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-gold-2">
          We&apos;re here to help
        </p>
        <h2 className="mt-1 text-xl font-bold tracking-tight text-soft">Help centre</h2>
        <p className="mt-1.5 text-sm text-mist">
          Raise a ticket and the desk will get back to you. Track every conversation in one place.
        </p>
        <div className="gold-rule mt-4 h-px w-full" />
        <button
          type="button"
          onClick={() => setMode("new")}
          className="mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-gold-2 to-gold px-4 text-sm font-bold text-night transition hover:brightness-105 sm:w-auto sm:px-6"
        >
          <PlusIcon className="h-4 w-4" /> New ticket
        </button>
      </section>

      {error && <Note tone="error">{error}</Note>}

      {loading ? (
        <Empty>Loading tickets…</Empty>
      ) : tickets.length > 0 ? (
        <section className="space-y-3">
          {tickets.map((t: SupportTicketDto) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setOpenId(t.id)}
              className="surface surface-hover flex w-full flex-col gap-2 p-5 text-left"
            >
              <div className="flex flex-wrap items-center gap-2">
                <Badge className={STATUS_META[t.status].className}>
                  {STATUS_META[t.status].label}
                </Badge>
                <Badge className={PRIORITY_META[t.priority].className}>
                  {PRIORITY_META[t.priority].label}
                </Badge>
                <Badge>{t.category}</Badge>
                <span className="ml-auto text-[11px] font-semibold text-mist">
                  {fmtWhen(t.lastMessageAt)}
                </span>
              </div>
              <h3 className="text-base font-bold leading-snug text-soft">{t.subject}</h3>
            </button>
          ))}
        </section>
      ) : (
        <section className="surface grid place-items-center gap-3 p-10 text-center">
          <span className="grid h-12 w-12 place-items-center rounded-2xl border border-gold/25 bg-gold/10 text-gold-2">
            <LifebuoyIcon className="h-6 w-6" />
          </span>
          <p className="text-sm text-mist">No tickets yet. Need a hand? Open one above.</p>
        </section>
      )}

      <div className="flex justify-center pt-1">
        <button
          type="button"
          onClick={() => setMode("new")}
          className="inline-flex items-center gap-1.5 text-xs font-bold text-gold-2 transition hover:underline"
        >
          <PlusIcon className="h-3.5 w-3.5" /> New ticket
        </button>
      </div>
    </PortalPage>
  );
}
