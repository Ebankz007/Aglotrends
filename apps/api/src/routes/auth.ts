import { Router } from 'express';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db, schema } from '../db.js';
import { asyncHandler } from '../lib/async.js';
import { ApiError } from '../lib/errors.js';
import {
  clearSessionCookie,
  hashPassword,
  requireAuth,
  setSessionCookie,
  signChallengeToken,
  signToken,
  verifyPassword,
} from '../lib/auth.js';
import { publicUser } from '../lib/user-view.js';
import { getPlatformSettings } from '../services/settings.js';

export const authRouter = Router();

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  fullName: z.string().min(1),
  phone: z.string().optional(),
  country: z.string().optional(),
  // A referrer is compulsory — every account enters under a sponsor. The
  // address must resolve to an existing member; a dangling or missing
  // referrer is a 400 and nothing is written.
  sponsorEmail: z.string().email(),
});

authRouter.post(
  '/register',
  asyncHandler(async (req, res) => {
    // Console-controlled kill switch. Checked before anything is written so a
    // closed registration never leaves a half-created account behind.
    const { registrationOpen } = await getPlatformSettings();
    if (!registrationOpen) {
      throw ApiError.forbidden('Registration is currently closed', 'REGISTRATION_CLOSED');
    }

    const body = registerSchema.parse(req.body);
    const email = body.email.toLowerCase();

    const [existing] = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.email, email));
    if (existing) throw ApiError.conflict('Email already registered');

    let sponsorId: string | null = null;
    {
      const [sponsor] = await db
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(eq(schema.users.email, body.sponsorEmail.toLowerCase()));
      if (!sponsor)
        throw ApiError.badRequest(
          'Referrer not found — registration requires a valid referrer link or email',
          'SPONSOR_NOT_FOUND',
        );
      sponsorId = sponsor.id;
    }

    const [user] = await db
      .insert(schema.users)
      .values({
        email,
        passwordHash: hashPassword(body.password),
        fullName: body.fullName,
        phone: body.phone ?? null,
        country: body.country ?? null,
        sponsorId,
        status: 'ACTIVE',
        // Compensation is GATED on the §1 membership fee. A new member is not
        // placed in the matrix and earns nothing until the $20 payment clears —
        // see services/payment-service.ts → ensureRegistrationProcessed, which
        // runs processRegistration from the Pay2Crypto webhook.
        isActiveMember: false,
        emailVerifiedAt: new Date(),
      })
      .returning();
    if (!user) throw new Error('register: insert failed');

    await db.insert(schema.wallets).values({ userId: user.id, balanceCents: 0 }).onConflictDoNothing();

    const token = signToken({ id: user.id, role: user.role });
    setSessionCookie(res, token);

    // No compensation here. The client is told to settle the fee; the wallet
    // page creates the invoice and the webhook activates the account.
    res.status(201).json({ token, user: publicUser(user), paymentRequired: true });
  }),
);

const loginSchema = z.object({ email: z.string().email(), password: z.string() });

authRouter.post(
  '/login',
  asyncHandler(async (req, res) => {
    const body = loginSchema.parse(req.body);
    const [user] = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, body.email.toLowerCase()));
    if (!user || !verifyPassword(body.password, user.passwordHash)) {
      throw ApiError.unauthorized('Invalid credentials');
    }
    if (user.status === 'SUSPENDED') throw ApiError.forbidden('Account suspended');

    // The password is correct, but a password alone does not earn a session
    // when a second factor is enrolled. Hand back a short-lived, single-purpose
    // challenge token instead; /auth/2fa/verify trades it for a real session.
    if (user.twoFactorEnabled) {
      res.json({ twoFactorRequired: true, challengeToken: signChallengeToken(user.id) });
      return;
    }

    await db.update(schema.users).set({ lastLoginAt: new Date() }).where(eq(schema.users.id, user.id));
    const token = signToken({ id: user.id, role: user.role });
    setSessionCookie(res, token);
    res.json({ token, user: publicUser(user) });
  }),
);

authRouter.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const [user] = await db.select().from(schema.users).where(eq(schema.users.id, req.user!.id));
    if (!user) throw ApiError.notFound('User not found');
    const isStaff = user.role === 'ADMIN' || user.role === 'SUPERADMIN';
    res.json({
      user: publicUser(user),
      // Staff who have not enrolled cannot reach the console; the client uses
      // this to route them straight to enrolment instead of a wall of 403s.
      twoFactorRequired: isStaff && !user.twoFactorEnabled,
    });
  }),
);

/** Clear the session cookie. Safe to call without a valid session. */
authRouter.post('/logout', (_req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});
