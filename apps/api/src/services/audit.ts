import { db, schema } from '../db.js';

/** Append an audit-log entry. Fire-and-forget from routes. */
export async function audit(
  actorId: string | null,
  action: string,
  targetType?: string,
  targetId?: string,
  metadata?: unknown,
): Promise<void> {
  await db.insert(schema.auditLog).values({
    actorId,
    action,
    targetType: targetType ?? null,
    targetId: targetId ?? null,
    metadata: (metadata ?? null) as Record<string, unknown> | null,
  });
}
