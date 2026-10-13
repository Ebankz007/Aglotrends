import { and, asc, desc, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import { db, schema } from '../db.js';
import { ApiError } from '../lib/errors.js';

/**
 * Events — scheduled webinars, workshops, and meetups.
 *
 * A member RSVP is a soft intent (no payment). One row per member per event,
 * enforced by a unique index; re-RSVPing upserts rather than duplicating. The
 * upcoming/past split is driven by `startsAt` against the current time.
 */

export type RsvpStatus = 'GOING' | 'CANCELLED';

export interface EventInput {
  title: string;
  description?: string | null;
  startsAt: Date;
  endsAt?: Date | null;
  location?: string | null;
  url?: string | null;
  coverImageUrl?: string | null;
  isPublished?: boolean;
}

export type EventRow = typeof schema.events.$inferSelect;
export type EventWithRsvp = EventRow & { rsvpCount: number; myRsvp: RsvpStatus | null };

/** Attach the live RSVP count and the caller's own RSVP to each event. */
async function decorate(rows: EventRow[], userId: string): Promise<EventWithRsvp[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);

  const counts = await db
    .select({
      eventId: schema.eventRegistrations.eventId,
      n: sql<number>`count(*)::int`,
    })
    .from(schema.eventRegistrations)
    .where(
      and(
        inArray(schema.eventRegistrations.eventId, ids),
        eq(schema.eventRegistrations.status, 'GOING'),
      ),
    )
    .groupBy(schema.eventRegistrations.eventId);

  const mine = await db
    .select({
      eventId: schema.eventRegistrations.eventId,
      status: schema.eventRegistrations.status,
    })
    .from(schema.eventRegistrations)
    .where(
      and(
        inArray(schema.eventRegistrations.eventId, ids),
        eq(schema.eventRegistrations.userId, userId),
      ),
    );

  const countMap = new Map(counts.map((c) => [c.eventId, c.n]));
  const mineMap = new Map(mine.map((m) => [m.eventId, m.status as RsvpStatus]));
  return rows.map((r) => ({
    ...r,
    rsvpCount: countMap.get(r.id) ?? 0,
    myRsvp: mineMap.get(r.id) ?? null,
  }));
}

export async function listUpcomingEvents(userId: string): Promise<EventWithRsvp[]> {
  const rows = await db
    .select()
    .from(schema.events)
    .where(and(eq(schema.events.isPublished, true), gte(schema.events.startsAt, new Date())))
    .orderBy(asc(schema.events.startsAt))
    .limit(100);
  return decorate(rows, userId);
}

export async function listPastEvents(userId: string): Promise<EventWithRsvp[]> {
  const rows = await db
    .select()
    .from(schema.events)
    .where(and(eq(schema.events.isPublished, true), lt(schema.events.startsAt, new Date())))
    .orderBy(desc(schema.events.startsAt))
    .limit(50);
  return decorate(rows, userId);
}

export async function getEvent(id: string, userId: string): Promise<EventWithRsvp> {
  const [row] = await db
    .select()
    .from(schema.events)
    .where(and(eq(schema.events.id, id), eq(schema.events.isPublished, true)))
    .limit(1);
  if (!row) throw ApiError.notFound('Event not found');
  const [decorated] = await decorate([row], userId);
  return decorated!;
}

/** RSVP (or re-RSVP after cancelling). Upsert on the (event, user) unique key. */
export async function rsvp(userId: string, eventId: string): Promise<RsvpStatus> {
  const [ev] = await db
    .select({ id: schema.events.id })
    .from(schema.events)
    .where(and(eq(schema.events.id, eventId), eq(schema.events.isPublished, true)))
    .limit(1);
  if (!ev) throw ApiError.notFound('Event not found');

  await db
    .insert(schema.eventRegistrations)
    .values({ eventId, userId, status: 'GOING' })
    .onConflictDoUpdate({
      target: [schema.eventRegistrations.eventId, schema.eventRegistrations.userId],
      set: { status: 'GOING' },
    });
  return 'GOING';
}

/** Cancel an RSVP. A no-op when the member was never registered. */
export async function cancelRsvp(userId: string, eventId: string): Promise<RsvpStatus> {
  await db
    .update(schema.eventRegistrations)
    .set({ status: 'CANCELLED' })
    .where(
      and(
        eq(schema.eventRegistrations.eventId, eventId),
        eq(schema.eventRegistrations.userId, userId),
      ),
    );
  return 'CANCELLED';
}

/* --------------------------------------------------------------- operator */

export async function listAllEvents() {
  return db.select().from(schema.events).orderBy(desc(schema.events.startsAt)).limit(500);
}

export async function createEvent(input: EventInput) {
  const [row] = await db
    .insert(schema.events)
    .values({
      title: input.title.trim(),
      description: input.description?.trim() || null,
      startsAt: input.startsAt,
      endsAt: input.endsAt ?? null,
      location: input.location?.trim() || null,
      url: input.url?.trim() || null,
      coverImageUrl: input.coverImageUrl?.trim() || null,
      isPublished: input.isPublished ?? true,
    })
    .returning();
  if (!row) throw new Error('createEvent: insert failed');
  return row;
}

export async function updateEvent(id: string, input: Partial<EventInput>) {
  const [row] = await db
    .update(schema.events)
    .set({
      ...(input.title !== undefined ? { title: input.title.trim() } : {}),
      ...(input.description !== undefined ? { description: input.description?.trim() || null } : {}),
      ...(input.startsAt !== undefined ? { startsAt: input.startsAt } : {}),
      ...(input.endsAt !== undefined ? { endsAt: input.endsAt } : {}),
      ...(input.location !== undefined ? { location: input.location?.trim() || null } : {}),
      ...(input.url !== undefined ? { url: input.url?.trim() || null } : {}),
      ...(input.coverImageUrl !== undefined
        ? { coverImageUrl: input.coverImageUrl?.trim() || null }
        : {}),
      ...(input.isPublished !== undefined ? { isPublished: input.isPublished } : {}),
      updatedAt: new Date(),
    })
    .where(eq(schema.events.id, id))
    .returning();
  if (!row) throw ApiError.notFound('Event not found');
  return row;
}

export async function deleteEvent(id: string) {
  const [row] = await db.delete(schema.events).where(eq(schema.events.id, id)).returning();
  if (!row) throw ApiError.notFound('Event not found');
  return row;
}

/** The RSVP roster for one event, with member identity for the operator. */
export async function listEventRegistrations(eventId: string) {
  return db
    .select({
      id: schema.eventRegistrations.id,
      userId: schema.eventRegistrations.userId,
      status: schema.eventRegistrations.status,
      createdAt: schema.eventRegistrations.createdAt,
      userEmail: schema.users.email,
      userFullName: schema.users.fullName,
    })
    .from(schema.eventRegistrations)
    .leftJoin(schema.users, eq(schema.users.id, schema.eventRegistrations.userId))
    .where(eq(schema.eventRegistrations.eventId, eventId))
    .orderBy(desc(schema.eventRegistrations.createdAt));
}
