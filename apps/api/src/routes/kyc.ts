import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../lib/async.js';
import { requireAuth } from '../lib/auth.js';
import { getKycView, submitKyc } from '../services/kyc.js';

/**
 * Member-facing KYC/AML endpoints.
 *
 * Reads always return the MASKED view — the document number never leaves the
 * server in full. Submission is the only write, and a VERIFIED profile is
 * immutable from this side.
 */
export const kycRouter = Router();
kycRouter.use(requireAuth);

kycRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json({ kyc: await getKycView(req.user!.id) });
  }),
);

const submitSchema = z.object({
  legalName: z.string().trim().min(2).max(200),
  dateOfBirth: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date of birth must be YYYY-MM-DD'),
  country: z.string().trim().min(2).max(100),
  address: z.string().trim().min(5).max(500),
  idType: z.string().trim().min(2).max(50),
  idNumber: z.string().trim().min(3).max(100),
  /** Opaque document references (URLs / storage keys) — the upload target is a deployment concern. */
  documents: z.unknown().optional(),
});

kycRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const body = submitSchema.parse(req.body);
    const kyc = await submitKyc(req.user!.id, body);
    res.status(201).json({ kyc });
  }),
);
