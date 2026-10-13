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
  createEvent,
  deleteEvent,
  fetchAdminEvents,
  fetchEventRegistrations,
  updateEvent,
} from "@/lib/api";
import { formatDateTime } from "@/lib/format";

function toIso(local: string): string | null {
  if (!local) return null;
  const d = new Date(local);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function EventsTab() {
  const { data, error, loading, reload } = useAsync(fetchAdminEvents);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [location, setLocation] = useState("");
  const [url, setUrl] = useState("");
  const [coverImageUrl, setCoverImageUrl] = useState("");
  const [isPublished, setIsPublished] = useState(true);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [rosterId, setRosterId] = useState<string | null>(null);

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setOk(null);
    const startsAtIso = toIso(startsAt);
    if (!title.trim() || !startsAtIso) {
      setFormError("Title and start time are required.");
      return;
    }
    setBusy(true);
    try {
      await createEvent({
        title: title.trim(),
        description: description.trim() || null,
        startsAt: startsAtIso,
        endsAt: toIso(endsAt),
        location: location.trim() || null,
        url: url.trim() || null,
        coverImageUrl: coverImageUrl.trim() || null,
        isPublished,
      });
      setOk(isPublished ? "Event created and published." : "Event saved as draft.");
      setTitle("");
      setDescription("");
      setStartsAt("");
      setEndsAt("");
      setLocation("");
      setUrl("");
      setCoverImageUrl("");
      reload();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Could not create the event.");
    } finally {
      setBusy(false);
    }
  }

  async function onTogglePublish(id: string, published: boolean) {
    setActionError(null);
    try {
      await updateEvent(id, { isPublished: !published });
      reload();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Could not update.");
    }
  }

  async function onDelete(id: string, title: string) {
    if (!window.confirm(`Delete "${title}"? This cannot be undone.`)) return;
    setActionError(null);
    try {
      await deleteEvent(id);
      if (rosterId === id) setRosterId(null);
      reload();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Could not delete.");
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <Panel title="Schedule an event">
        <form onSubmit={onCreate} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field label="Title" value={title} onChange={setTitle} placeholder="Weekly market outlook" />
          </div>
          <label className="block">
            <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-[0.12em] text-mist">
              Starts at
            </span>
            <input
              type="datetime-local"
              value={startsAt}
              onChange={(e) => setStartsAt(e.target.value)}
              className="w-full rounded-2xl border border-white/10 bg-night-2 px-4 py-3 text-[15px] text-soft outline-none transition focus:border-brand/50"
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-[0.12em] text-mist">
              Ends at (optional)
            </span>
            <input
              type="datetime-local"
              value={endsAt}
              onChange={(e) => setEndsAt(e.target.value)}
              className="w-full rounded-2xl border border-white/10 bg-night-2 px-4 py-3 text-[15px] text-soft outline-none transition focus:border-brand/50"
            />
          </label>
          <Field label="Location (optional)" value={location} onChange={setLocation} placeholder="Online / Lagos" />
          <Field label="Join URL (optional)" value={url} onChange={setUrl} placeholder="https://…" />
          <div className="sm:col-span-2">
            <Field
              label="Cover image URL (optional)"
              value={coverImageUrl}
              onChange={setCoverImageUrl}
              placeholder="https://…"
            />
          </div>
          <label className="block sm:col-span-2">
            <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-[0.12em] text-mist">
              Description (optional)
            </span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="What the session covers…"
              className="w-full resize-y rounded-2xl border border-white/10 bg-night-2 px-4 py-3 text-[15px] text-soft outline-none transition focus:border-brand/50"
            />
          </label>
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input
              type="checkbox"
              checked={isPublished}
              onChange={(e) => setIsPublished(e.target.checked)}
            />
            Publish immediately
          </label>
          {formError && (
            <div className="sm:col-span-2">
              <Note tone="error">{formError}</Note>
            </div>
          )}
          {ok && (
            <div className="sm:col-span-2">
              <Note tone="ok">{ok}</Note>
            </div>
          )}
          <div className="sm:col-span-2">
            <ActionButton type="submit">{busy ? "Saving…" : "Create event"}</ActionButton>
          </div>
        </form>
      </Panel>

      <Panel title="Events">
        {actionError && <Note tone="error">{actionError}</Note>}
        {error && <Note tone="error">{error}</Note>}
        {loading ? (
          <Empty>Loading…</Empty>
        ) : data && data.length > 0 ? (
          <Table columns={["Title", "Starts", "Location", "Status", ""]}>
            {data.map((ev) => (
              <Tr key={ev.id}>
                <Td className="font-semibold">{ev.title}</Td>
                <Td className="whitespace-nowrap text-xs text-mist">
                  {new Date(ev.startsAt).toLocaleString()}
                </Td>
                <Td className="text-mist">{ev.location ?? "—"}</Td>
                <Td>
                  <Badge tone={ev.isPublished ? "ok" : "neutral"}>
                    {ev.isPublished ? "PUBLISHED" : "DRAFT"}
                  </Badge>
                </Td>
                <Td>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => setRosterId(rosterId === ev.id ? null : ev.id)}
                      className="rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs font-bold text-soft transition hover:bg-white/10"
                    >
                      {rosterId === ev.id ? "Hide roster" : "Roster"}
                    </button>
                    <button
                      type="button"
                      onClick={() => onTogglePublish(ev.id, ev.isPublished)}
                      className="rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs font-bold text-soft transition hover:bg-white/10"
                    >
                      {ev.isPublished ? "Unpublish" : "Publish"}
                    </button>
                    <button
                      type="button"
                      onClick={() => onDelete(ev.id, ev.title)}
                      className="rounded-full border border-red-400/30 bg-red-400/10 px-3 py-1 text-xs font-bold text-red-300 transition hover:bg-red-400/20"
                    >
                      Delete
                    </button>
                  </div>
                </Td>
              </Tr>
            ))}
          </Table>
        ) : (
          <Empty>No events yet.</Empty>
        )}
      </Panel>

      {rosterId && <RosterPanel eventId={rosterId} />}
    </div>
  );
}

function RosterPanel({ eventId }: { eventId: string }) {
  const { data, error, loading } = useAsync(() => fetchEventRegistrations(eventId));

  return (
    <Panel title="RSVP roster">
      {error && <Note tone="error">{error}</Note>}
      {loading ? (
        <Empty>Loading roster…</Empty>
      ) : data && data.length > 0 ? (
        <Table columns={["Member", "Email", "Status", "Responded"]}>
          {data.map((r) => (
            <Tr key={r.id}>
              <Td className="font-semibold">{r.userFullName ?? "—"}</Td>
              <Td className="text-mist">{r.userEmail ?? "—"}</Td>
              <Td>
                <Badge tone={r.status === "GOING" ? "ok" : "neutral"}>{r.status}</Badge>
              </Td>
              <Td className="whitespace-nowrap text-xs text-mist">{formatDateTime(r.createdAt)}</Td>
            </Tr>
          ))}
        </Table>
      ) : (
        <Empty>No RSVPs yet.</Empty>
      )}
    </Panel>
  );
}
