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
  signToken,
  verifyPassword,
} from '../lib/auth.js';

export const authRouter = Router();

type UserRow = typeof schema.users.$inferSelect;

function publicUser(u: UserRow) {
  return {
    id: u.id,
    email: u.email,
    fullName: u.fullName,
    role: u.role,
    status: u.status,
    sponsorId: u.sponsorId,
    isActiveMember: u.isActiveMember,
    highestAssociateRank: u.highestAssociateRank,
    highestLeadershipRank: u.highestLeadershipRank,
  };
}

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  fullName: z.string().min(1),
  phone: z.string().optional(),
  country: z.string().optional(),
  sponsorEmail: z.string().email().optional(),
});

authRouter.post(
  '/register',
  asyncHandler(async (req, res) => {
    const body = registerSchema.parse(req.body);
    const email = body.email.toLowerCase();

    const [existing] = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.email, email));
    if (existing) throw ApiError.conflict('Email already registered');

    let sponsorId: string | null = null;
    if (body.sponsorEmail) {
      const [sponsor] = await db
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(eq(schema.users.email, body.sponsorEmail.toLowerCase()));
      if (!sponsor) throw ApiError.badRequest('Sponsor not found');
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
    res.json({ user: publicUser(user) });
  }),
);

/** Clear the session cookie. Safe to call without a valid session. */
authRouter.post('/logout', (_req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});
