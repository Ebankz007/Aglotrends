"use client";

import { useEffect, useState } from "react";
import { useAsync } from "@/lib/hooks";
import {
  cancelEventRsvp,
  fetchEvents,
  rsvpEvent,
  type EventDto,
} from "@/lib/api";
import { PortalPage, Empty, Note, Badge } from "@/components/portal-ui";
import { ArrowUpRightIcon, CalendarIcon, CheckIcon } from "@/components/icons";

function fmtWhen(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function monthDay(iso: string): { month: string; day: string } {
  const d = new Date(iso);
  return {
    month: d.toLocaleString(undefined, { month: "short" }).toUpperCase(),
    day: String(d.getDate()),
  };
}

function EventCard({
  event,
  past,
  onToggle,
}: {
  event: EventDto;
  past?: boolean;
  onToggle: (event: EventDto) => void;
}) {
  const going = event.myRsvp === "GOING";
  const { month, day } = monthDay(event.startsAt);

  return (
    <article className={`surface flex gap-4 p-5 ${past ? "opacity-80" : "gold-top"}`}>
      <div
        className={`grid h-16 w-16 shrink-0 place-items-center rounded-2xl border text-center ${
          past
            ? "border-white/10 bg-white/5 text-mist"
            : "border-gold/30 bg-gold/10 text-gold-2"
        }`}
      >
        <div>
          <div className="text-[10px] font-bold tracking-[0.14em]">{month}</div>
          <div className="text-xl font-black leading-none">{day}</div>
        </div>
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={past ? "neutral" : "ok"}>{past ? "Past" : "Upcoming"}</Badge>
          {going && (
            <Badge className="border-emerald-400/30 bg-emerald-400/10 text-emerald-300">
              <CheckIcon className="h-3 w-3" /> Going
            </Badge>
          )}
          {event.rsvpCount > 0 && (
            <span className="text-[11px] font-bold text-mist">
              {event.rsvpCount} attending
            </span>
          )}
        </div>

        <h3 className="mt-2 text-base font-bold leading-snug text-soft">{event.title}</h3>
        <p className="mt-1 text-xs font-semibold text-gold-2">{fmtWhen(event.startsAt)}</p>
        {event.description && (
          <p className="mt-1.5 line-clamp-2 text-sm text-mist">{event.description}</p>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-3">
          {event.location && (
            <span className="text-xs font-semibold text-mist">{event.location}</span>
          )}
          {event.url && (
            <a
              href={event.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs font-bold text-brand-2 hover:underline"
            >
              Join link <ArrowUpRightIcon className="h-3.5 w-3.5" />
            </a>
          )}
          {!past && (
            <button
              type="button"
              onClick={() => onToggle(event)}
              className={`ml-auto inline-flex min-h-9 items-center gap-1.5 rounded-full border px-4 text-xs font-bold transition ${
                going
                  ? "border-white/15 bg-white/5 text-mist hover:bg-white/10"
                  : "border-gold/40 bg-gold/15 text-gold-2 hover:bg-gold/25"
              }`}
            >
              {going ? "Cancel RSVP" : "RSVP"}
            </button>
          )}
        </div>
      </div>
    </article>
  );
}

export function EventsCenter() {
  const { data, error, loading } = useAsync(fetchEvents);
  const [upcoming, setUpcoming] = useState<EventDto[]>([]);
  const [past, setPast] = useState<EventDto[]>([]);

  useEffect(() => {
    if (!data) return;
    setUpcoming(data.upcoming);
    setPast(data.past);
  }, [data]);

  async function toggle(event: EventDto) {
    const going = event.myRsvp === "GOING";
    setUpcoming((prev) =>
      prev.map((e) =>
        e.id === event.id
          ? {
              ...e,
              myRsvp: going ? null : "GOING",
              rsvpCount: Math.max(0, e.rsvpCount + (going ? -1 : 1)),
            }
          : e,
      ),
    );
    try {
      if (going) await cancelEventRsvp(event.id);
      else await rsvpEvent(event.id);
    } catch {
      setUpcoming((prev) => prev.map((e) => (e.id === event.id ? event : e)));
    }
  }

  return (
    <PortalPage title="Events">
      <section className="surface p-5">
        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-gold-2">
          Live &amp; in person
        </p>
        <h2 className="mt-1 text-xl font-bold tracking-tight text-soft">
          Webinars, workshops &amp; meetups
        </h2>
        <p className="mt-1.5 text-sm text-mist">
          Reserve your seat for live sessions with the desk and the community.
        </p>
        <div className="gold-rule mt-4 h-px w-full" />
      </section>

      {error && <Note tone="error">{error}</Note>}

      {loading ? (
        <Empty>Loading events…</Empty>
      ) : (
        <>
          <section className="space-y-3">
            <h3 className="flex items-center gap-2 text-sm font-bold uppercase tracking-[0.14em] text-soft">
              <CalendarIcon className="h-4 w-4 text-gold-2" /> Upcoming
            </h3>
            {upcoming.length > 0 ? (
              upcoming.map((e) => <EventCard key={e.id} event={e} onToggle={toggle} />)
            ) : (
              <Empty>No upcoming events scheduled.</Empty>
            )}
          </section>

          {past.length > 0 && (
            <section className="space-y-3">
              <h3 className="text-sm font-bold uppercase tracking-[0.14em] text-mist">Past</h3>
              {past.map((e) => <EventCard key={e.id} event={e} past onToggle={toggle} />)}
            </section>
          )}
        </>
      )}
    </PortalPage>
  );
}
