import { and, asc, desc, eq } from 'drizzle-orm';
import { db, schema } from '../db.js';
import { ApiError } from '../lib/errors.js';

/**
 * Education — the member learning library.
 *
 * Operator-authored resources (articles, videos, external links). Members only
 * ever see `isPublished` rows; the admin side sees everything. `sortOrder` is
 * the operator's curation order (lower first), with newest as the tiebreak.
 */

export type EducationResourceType = 'ARTICLE' | 'VIDEO' | 'LINK';

export interface EducationInput {
  title: string;
  summary?: string | null;
  body?: string | null;
  category?: string;
  level?: string | null;
  resourceType?: EducationResourceType;
  url?: string | null;
  coverImageUrl?: string | null;
  isPublished?: boolean;
  sortOrder?: number;
}

const order = [asc(schema.educationResources.sortOrder), desc(schema.educationResources.createdAt)];

/** Published resources for the member library. */
export async function listPublishedResources() {
  return db
    .select()
    .from(schema.educationResources)
    .where(eq(schema.educationResources.isPublished, true))
    .orderBy(...order);
}

/** A single published resource, or 404 — an unpublished row is invisible. */
export async function getPublishedResource(id: string) {
  const [row] = await db
    .select()
    .from(schema.educationResources)
    .where(
      and(eq(schema.educationResources.id, id), eq(schema.educationResources.isPublished, true)),
    )
    .limit(1);
  if (!row) throw ApiError.notFound('Resource not found');
  return row;
}

/* --------------------------------------------------------------- operator */

/** Every resource, published or not. */
export async function listAllResources() {
  return db.select().from(schema.educationResources).orderBy(...order);
}

export async function createResource(input: EducationInput) {
  const [row] = await db
    .insert(schema.educationResources)
    .values({
      title: input.title.trim(),
      summary: input.summary?.trim() || null,
      body: input.body?.trim() || null,
      category: (input.category?.trim() || 'GENERAL').toUpperCase(),
      level: input.level?.trim() || null,
      resourceType: input.resourceType ?? 'ARTICLE',
      url: input.url?.trim() || null,
      coverImageUrl: input.coverImageUrl?.trim() || null,
      isPublished: input.isPublished ?? false,
      sortOrder: input.sortOrder ?? 0,
    })
    .returning();
  if (!row) throw new Error('createResource: insert failed');
  return row;
}

export async function updateResource(id: string, input: Partial<EducationInput>) {
  const [row] = await db
    .update(schema.educationResources)
    .set({
      ...(input.title !== undefined ? { title: input.title.trim() } : {}),
      ...(input.summary !== undefined ? { summary: input.summary?.trim() || null } : {}),
      ...(input.body !== undefined ? { body: input.body?.trim() || null } : {}),
      ...(input.category !== undefined
        ? { category: input.category.trim().toUpperCase() || 'GENERAL' }
        : {}),
      ...(input.level !== undefined ? { level: input.level?.trim() || null } : {}),
      ...(input.resourceType !== undefined ? { resourceType: input.resourceType } : {}),
      ...(input.url !== undefined ? { url: input.url?.trim() || null } : {}),
      ...(input.coverImageUrl !== undefined
        ? { coverImageUrl: input.coverImageUrl?.trim() || null }
        : {}),
      ...(input.isPublished !== undefined ? { isPublished: input.isPublished } : {}),
      ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
      updatedAt: new Date(),
    })
    .where(eq(schema.educationResources.id, id))
    .returning();
  if (!row) throw ApiError.notFound('Resource not found');
  return row;
}

export async function deleteResource(id: string) {
  const [row] = await db
    .delete(schema.educationResources)
    .where(eq(schema.educationResources.id, id))
    .returning();
  if (!row) throw ApiError.notFound('Resource not found');
  return row;
}
