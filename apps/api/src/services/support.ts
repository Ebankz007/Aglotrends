import { and, asc, desc, eq, type SQL } from 'drizzle-orm';
import { db, schema } from '../db.js';
import { ApiError } from '../lib/errors.js';

/**
 * Support — member↔operator ticket threads.
 *
 * Status model:
 *   OPEN      the ball is in the operator's court (new ticket, or a member reply)
 *   PENDING   the operator has replied; awaiting the member
 *   RESOLVED  the operator considers it handled
 *   CLOSED    archived; the member can no longer post
 *
 * `lastMessageAt` is denormalised so both inboxes sort by recency without a
 * join. Every write that adds a message also bumps it, in one transaction.
 */

export type TicketStatus = 'OPEN' | 'PENDING' | 'RESOLVED' | 'CLOSED';
export type TicketPriority = 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';

export interface CreateTicketInput {
  subject: string;
  category?: string;
  priority?: TicketPriority;
  message: string;
}

export type TicketRow = typeof schema.supportTickets.$inferSelect;
export type MessageRow = typeof schema.supportMessages.$inferSelect;

/* ----------------------------------------------------------------- member */

export async function createTicket(userId: string, input: CreateTicketInput): Promise<TicketRow> {
  return db.transaction(async (tx) => {
    const now = new Date();
    const [ticket] = await tx
      .insert(schema.supportTickets)
      .values({
        userId,
        subject: input.subject.trim(),
        category: (input.category?.trim() || 'GENERAL').toUpperCase(),
        priority: input.priority ?? 'NORMAL',
        status: 'OPEN',
        lastMessageAt: now,
      })
      .returning();
    if (!ticket) throw new Error('createTicket: insert failed');
    await tx.insert(schema.supportMessages).values({
      ticketId: ticket.id,
      authorId: userId,
      authorRole: 'MEMBER',
      body: input.message.trim(),
    });
    return ticket;
  });
}

export async function listMyTickets(userId: string): Promise<TicketRow[]> {
  return db
    .select()
    .from(schema.supportTickets)
    .where(eq(schema.supportTickets.userId, userId))
    .orderBy(desc(schema.supportTickets.lastMessageAt))
    .limit(200);
}

async function loadThread(
  where: SQL | undefined,
): Promise<{ ticket: TicketRow; messages: MessageRow[] }> {
  const [ticket] = await db.select().from(schema.supportTickets).where(where).limit(1);
  if (!ticket) throw ApiError.notFound('Ticket not found');
  const messages = await db
    .select()
    .from(schema.supportMessages)
    .where(eq(schema.supportMessages.ticketId, ticket.id))
    .orderBy(asc(schema.supportMessages.createdAt));
  return { ticket, messages };
}

export async function getTicketForMember(userId: string, ticketId: string) {
  return loadThread(
    and(eq(schema.supportTickets.id, ticketId), eq(schema.supportTickets.userId, userId)),
  );
}

/** A member reply reopens a RESOLVED ticket; a CLOSED one is frozen. */
export async function addMemberMessage(userId: string, ticketId: string, body: string) {
  const [ticket] = await db
    .select()
    .from(schema.supportTickets)
    .where(and(eq(schema.supportTickets.id, ticketId), eq(schema.supportTickets.userId, userId)))
    .limit(1);
  if (!ticket) throw ApiError.notFound('Ticket not found');
  if (ticket.status === 'CLOSED') {
    throw ApiError.conflict('This ticket is closed. Open a new ticket to continue.', 'TICKET_CLOSED');
  }

  await db.transaction(async (tx) => {
    const now = new Date();
    await tx.insert(schema.supportMessages).values({
      ticketId,
      authorId: userId,
      authorRole: 'MEMBER',
      body: body.trim(),
    });
    await tx
      .update(schema.supportTickets)
      .set({
        lastMessageAt: now,
        updatedAt: now,
        status: ticket.status === 'RESOLVED' ? 'OPEN' : ticket.status,
      })
      .where(eq(schema.supportTickets.id, ticketId));
  });

  return getTicketForMember(userId, ticketId);
}

/* --------------------------------------------------------------- operator */

export interface AdminTicketRow extends TicketRow {
  userEmail: string | null;
  userFullName: string | null;
}

export async function listAllTickets(options?: {
  status?: TicketStatus;
  limit?: number;
}): Promise<AdminTicketRow[]> {
  const limit = Math.min(Math.max(options?.limit ?? 200, 1), 1000);
  const rows = await db
    .select({
      id: schema.supportTickets.id,
      userId: schema.supportTickets.userId,
      subject: schema.supportTickets.subject,
      category: schema.supportTickets.category,
      priority: schema.supportTickets.priority,
      status: schema.supportTickets.status,
      lastMessageAt: schema.supportTickets.lastMessageAt,
      createdAt: schema.supportTickets.createdAt,
      updatedAt: schema.supportTickets.updatedAt,
      userEmail: schema.users.email,
      userFullName: schema.users.fullName,
    })
    .from(schema.supportTickets)
    .leftJoin(schema.users, eq(schema.users.id, schema.supportTickets.userId))
    .where(options?.status ? eq(schema.supportTickets.status, options.status) : undefined)
    .orderBy(desc(schema.supportTickets.lastMessageAt))
    .limit(limit);
  return rows;
}

export async function getTicketForStaff(ticketId: string) {
  return loadThread(eq(schema.supportTickets.id, ticketId));
}

/** A staff reply moves an OPEN ticket to PENDING (awaiting the member). */
export async function addStaffMessage(adminId: string, ticketId: string, body: string) {
  const [ticket] = await db
    .select()
    .from(schema.supportTickets)
    .where(eq(schema.supportTickets.id, ticketId))
    .limit(1);
  if (!ticket) throw ApiError.notFound('Ticket not found');

  await db.transaction(async (tx) => {
    const now = new Date();
    await tx.insert(schema.supportMessages).values({
      ticketId,
      authorId: adminId,
      authorRole: 'STAFF',
      body: body.trim(),
    });
    await tx
      .update(schema.supportTickets)
      .set({
        lastMessageAt: now,
        updatedAt: now,
        status: 'PENDING',
      })
      .where(eq(schema.supportTickets.id, ticketId));
  });

  return getTicketForStaff(ticketId);
}

export async function setTicketStatus(ticketId: string, status: TicketStatus): Promise<TicketRow> {
  const [row] = await db
    .update(schema.supportTickets)
    .set({ status, updatedAt: new Date() })
    .where(eq(schema.supportTickets.id, ticketId))
    .returning();
  if (!row) throw ApiError.notFound('Ticket not found');
  return row;
}
