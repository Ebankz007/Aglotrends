import { desc, eq } from 'drizzle-orm';
import { db, schema } from '../db.js';
import { ApiError } from '../lib/errors.js';

/**
 * KYC/AML — identity verification.
 *
 * Policy (operator decision): KYC is enforced at the WITHDRAWAL boundary. A
 * member may register, pay, and earn without it, but no money leaves the system
 * until an operator has verified their identity. That is the choke point that
 * matters for AML: value can enter and accrue, but it cannot exit anonymously.
 *
 * `idNumber` is sensitive. It is stored whole (an operator must be able to
 * verify it) but NEVER returned whole by the API — reads go through `maskId`,
 * so a leaked session cannot dump identity documents.
 */

export type KycStatus = 'NOT_STARTED' | 'PENDING' | 'VERIFIED' | 'REJECTED';

export interface KycInput {
  legalName: string;
  dateOfBirth: string; // YYYY-MM-DD
  country: string;
  address: string;
  idType: string;
  idNumber: string;
  documents?: unknown;
}

/** Show only the last 4 characters — enough for an operator to match, useless to a thief. */
export function maskId(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (trimmed.length <= 4) return '••••';
  return `${'•'.repeat(Math.min(trimmed.length - 4, 8))}${trimmed.slice(-4)}`;
}

export interface KycView {
  status: KycStatus;
  legalName: string | null;
  dateOfBirth: string | null;
  country: string | null;
  address: string | null;
  idType: string | null;
  /** MASKED — never the full document number. */
  idNumberMasked: string | null;
  documents: unknown;
  submittedAt: Date | null;
  reviewedAt: Date | null;
  rejectionReason: string | null;
}

function toView(row: typeof schema.kycProfiles.$inferSelect): KycView {
  return {
    status: row.status as KycStatus,
    legalName: row.legalName,
    dateOfBirth: row.dateOfBirth,
    country: row.country,
    address: row.address,
    idType: row.idType,
    idNumberMasked: maskId(row.idNumber),
    documents: row.documents,
    submittedAt: row.submittedAt,
    reviewedAt: row.reviewedAt,
    rejectionReason: row.rejectionReason,
  };
}

/** A member's own KYC record, or a NOT_STARTED stub when none exists yet. */
export async function getKycView(userId: string): Promise<KycView> {
  const [row] = await db
    .select()
    .from(schema.kycProfiles)
    .where(eq(schema.kycProfiles.userId, userId))
    .limit(1);
  if (!row) {
    return {
      status: 'NOT_STARTED',
      legalName: null,
      dateOfBirth: null,
      country: null,
      address: null,
      idType: null,
      idNumberMasked: null,
      documents: null,
      submittedAt: null,
      reviewedAt: null,
      rejectionReason: null,
    };
  }
  return toView(row);
}

/** The raw status, for gating decisions. Absent profile reads as NOT_STARTED. */
export async function kycStatusFor(userId: string): Promise<KycStatus> {
  const [row] = await db
    .select({ status: schema.kycProfiles.status })
    .from(schema.kycProfiles)
    .where(eq(schema.kycProfiles.userId, userId))
    .limit(1);
  return (row?.status as KycStatus) ?? 'NOT_STARTED';
}

/**
 * The withdrawal gate. Throws a 403 the caller cannot mistake for a transient
 * failure, carrying the current status so the client can route the member to
 * the right screen.
 */
export async function assertKycVerified(userId: string): Promise<void> {
  const status = await kycStatusFor(userId);
  if (status === 'VERIFIED') return;
  throw new ApiError(
    403,
    status === 'PENDING'
      ? 'Your identity verification is still under review. Withdrawals unlock once it is approved.'
      : status === 'REJECTED'
        ? 'Your identity verification was rejected. Please resubmit before withdrawing.'
        : 'Identity verification is required before you can withdraw. Please complete KYC.',
    'KYC_REQUIRED',
  );
}

/**
 * Submit (or resubmit) identity details. A VERIFIED profile is immutable from
 * the member's side — once approved, only an operator can change it, so a
 * member cannot swap their identity after clearing the gate.
 */
export async function submitKyc(userId: string, input: KycInput): Promise<KycView> {
  const [existing] = await db
    .select()
    .from(schema.kycProfiles)
    .where(eq(schema.kycProfiles.userId, userId))
    .limit(1);

  if (existing?.status === 'VERIFIED') {
    throw ApiError.conflict(
      'Your identity is already verified. Contact support to make changes.',
      'KYC_ALREADY_VERIFIED',
    );
  }

  const now = new Date();
  const values = {
    legalName: input.legalName.trim(),
    dateOfBirth: input.dateOfBirth,
    country: input.country.trim(),
    address: input.address.trim(),
    idType: input.idType.trim(),
    idNumber: input.idNumber.trim(),
    documents: (input.documents ?? null) as Record<string, unknown> | null,
    status: 'PENDING' as const,
    submittedAt: now,
    // A resubmission clears the previous decision so the record reflects the
    // CURRENT submission, not the rejected one.
    reviewedAt: null,
    reviewedBy: null,
    rejectionReason: null,
    updatedAt: now,
  };

  if (existing) {
    await db.update(schema.kycProfiles).set(values).where(eq(schema.kycProfiles.userId, userId));
  } else {
    await db.insert(schema.kycProfiles).values({ userId, ...values });
  }

  return getKycView(userId);
}

/* --------------------------------------------------------------- operator side */

export interface KycSubmissionRow extends KycView {
  id: string;
  userId: string;
  userEmail: string | null;
  userFullName: string | null;
  reviewedBy: string | null;
}

export async function listKycSubmissions(options?: {
  status?: KycStatus;
  limit?: number;
}): Promise<KycSubmissionRow[]> {
  const limit = Math.min(Math.max(options?.limit ?? 200, 1), 1000);
  const where = options?.status ? eq(schema.kycProfiles.status, options.status) : undefined;

  const rows = await db
    .select({
      id: schema.kycProfiles.id,
      userId: schema.kycProfiles.userId,
      userEmail: schema.users.email,
      userFullName: schema.users.fullName,
      status: schema.kycProfiles.status,
      legalName: schema.kycProfiles.legalName,
      dateOfBirth: schema.kycProfiles.dateOfBirth,
      country: schema.kycProfiles.country,
      address: schema.kycProfiles.address,
      idType: schema.kycProfiles.idType,
      idNumber: schema.kycProfiles.idNumber,
      documents: schema.kycProfiles.documents,
      submittedAt: schema.kycProfiles.submittedAt,
      reviewedAt: schema.kycProfiles.reviewedAt,
      reviewedBy: schema.kycProfiles.reviewedBy,
      rejectionReason: schema.kycProfiles.rejectionReason,
    })
    .from(schema.kycProfiles)
    .leftJoin(schema.users, eq(schema.users.id, schema.kycProfiles.userId))
    .where(where)
    .orderBy(desc(schema.kycProfiles.submittedAt))
    .limit(limit);

  return rows.map((r) => ({
    id: r.id,
    userId: r.userId,
    userEmail: r.userEmail,
    userFullName: r.userFullName,
    status: r.status as KycStatus,
    legalName: r.legalName,
    dateOfBirth: r.dateOfBirth,
    country: r.country,
    address: r.address,
    idType: r.idType,
    idNumberMasked: maskId(r.idNumber),
    documents: r.documents,
    submittedAt: r.submittedAt,
    reviewedAt: r.reviewedAt,
    reviewedBy: r.reviewedBy,
    rejectionReason: r.rejectionReason,
  }));
}

/** Approve or reject a submission. Only a PENDING record may be reviewed. */
export async function reviewKyc(input: {
  userId: string;
  adminId: string;
  decision: 'VERIFIED' | 'REJECTED';
  reason?: string;
}): Promise<KycView> {
  const [existing] = await db
    .select()
    .from(schema.kycProfiles)
    .where(eq(schema.kycProfiles.userId, input.userId))
    .limit(1);
  if (!existing) throw ApiError.notFound('No KYC submission for that member');
  if (existing.status !== 'PENDING') {
    throw ApiError.conflict(
      `Cannot review a submission in status ${existing.status}`,
      'KYC_NOT_PENDING',
    );
  }
  if (input.decision === 'REJECTED' && !input.reason?.trim()) {
    throw ApiError.badRequest('A rejection reason is required', 'INVALID_INPUT');
  }

  await db
    .update(schema.kycProfiles)
    .set({
      status: input.decision,
      reviewedAt: new Date(),
      reviewedBy: input.adminId,
      rejectionReason: input.decision === 'REJECTED' ? input.reason!.trim() : null,
      updatedAt: new Date(),
    })
    .where(eq(schema.kycProfiles.userId, input.userId));

  return getKycView(input.userId);
}
