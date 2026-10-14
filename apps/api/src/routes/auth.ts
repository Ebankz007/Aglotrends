import { Router } from 'express';
import { z } from 'zod';
import { and, eq, isNull } from 'drizzle-orm';
import { db, schema } from '../db.js';
import { asyncHandler } from '../lib/async.js';
import { ApiError } from '../lib/errors.js';
import {
  clearSessionCookie,
  hashPassword,
  hashToken,
  requireAuth,
  setSessionCookie,
  signChallengeToken,
  signPasswordResetToken,
  signToken,
  verifyPassword,
  verifyPasswordResetToken,
} from '../lib/auth.js';
import { publicUser } from '../lib/user-view.js';
import { sendEmail } from '../notifications/email.js';
import { audit } from '../services/audit.js';
import { config } from '../config.js';
import { logger } from '../logger.js';
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

/* ------------------------------------------------------- forgot password */

/**
 * Process-local throttle (the API runs as a single process): max 5 reset
 * mails per address per hour, max 20 per IP per hour. Throttled callers get
 * the same 200 — the throttle must not become an enumeration oracle either.
 */
const forgotAttempts = new Map<string, number[]>();
const FORGOT_WINDOW_MS = 60 * 60 * 1000;

function forgotAllowed(key: string, limit: number): boolean {
  const now = Date.now();
  const recent = (forgotAttempts.get(key) ?? []).filter((t) => now - t < FORGOT_WINDOW_MS);
  if (recent.length >= limit) {
    forgotAttempts.set(key, recent);
    return false;
  }
  recent.push(now);
  forgotAttempts.set(key, recent);
  if (forgotAttempts.size > 20000) {
    const oldest = [...forgotAttempts.keys()].slice(0, 5000);
    for (const k of oldest) forgotAttempts.delete(k);
  }
  return true;
}

const forgotSchema = z.object({ email: z.string().email() });

/**
 * Request a password-reset link. ALWAYS 200 — whether the address exists, is
 * throttled, or the mail relay is down. Anything else lets strangers probe
 * which emails hold accounts.
 */
authRouter.post(
  '/forgot',
  asyncHandler(async (req, res) => {
    const body = forgotSchema.parse(req.body);
    const email = body.email.toLowerCase();
    const ip = req.ip ?? 'unknown';

    if (forgotAllowed(`forgot:email:${email}`, 5) && forgotAllowed(`forgot:ip:${ip}`, 20)) {
      const [user] = await db
        .select({ id: schema.users.id, email: schema.users.email })
        .from(schema.users)
        .where(eq(schema.users.email, email))
        .limit(1);
      if (user) {
        // A new link supersedes outstanding ones — only the freshest works.
        await db
          .update(schema.sessions)
          .set({ revokedAt: new Date() })
          .where(
            and(
              eq(schema.sessions.userId, user.id),
              eq(schema.sessions.purpose, 'PASSWORD_RESET'),
              isNull(schema.sessions.revokedAt),
            ),
          );
        const token = signPasswordResetToken(user.id);
        await db.insert(schema.sessions).values({
          userId: user.id,
          tokenHash: hashToken(token),
          purpose: 'PASSWORD_RESET',
          expiresAt: new Date(Date.now() + 60 * 60 * 1000),
          ip,
        });
        const link = `${config.APP_URL.replace(/\/$/, '')}/reset-password?token=${encodeURIComponent(token)}`;
        try {
          await sendEmail(
            user.email,
            'Reset your Aglotrends password',
            `A password reset was requested for your Aglotrends account.\n\nReset it here (valid 1 hour, single use):\n${link}\n\nIf you did not request this, ignore this message — your password is unchanged.`,
          );
        } catch (err) {
          // Delivery failure must not flip the 200 — and in mock-rail
          // production the link sits in the API log until SMTP is live.
          logger.warn(
            { err: err instanceof Error ? err.message : String(err), email: user.email },
            'password-reset mail not delivered',
          );
        }
      }
    }
    res.json({ ok: true });
  }),
);

const resetSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(8),
});

/**
 * Redeem a reset link: set the new password, burn the link. The sessions row
 * is the single-use token — a replayed link finds a revoked row and dies,
 * even inside its hour.
 */
authRouter.post(
  '/reset',
  asyncHandler(async (req, res) => {
    const body = resetSchema.parse(req.body);
    const userId = verifyPasswordResetToken(body.token);
    const [row] = await db
      .select()
      .from(schema.sessions)
      .where(
        and(
          eq(schema.sessions.tokenHash, hashToken(body.token)),
          eq(schema.sessions.purpose, 'PASSWORD_RESET'),
        ),
      )
      .limit(1);
    if (!row || row.userId !== userId || row.revokedAt || row.expiresAt.getTime() < Date.now()) {
      throw ApiError.badRequest(
        'This reset link is invalid or has already been used. Request a new one.',
        'RESET_TOKEN_INVALID',
      );
    }
    const [user] = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1);
    if (!user) {
      throw ApiError.badRequest(
        'This reset link is invalid or has already been used.',
        'RESET_TOKEN_INVALID',
      );
    }
    await db.transaction(async (tx) => {
      await tx
        .update(schema.users)
        .set({ passwordHash: hashPassword(body.password), updatedAt: new Date() })
        .where(eq(schema.users.id, userId));
      await tx
        .update(schema.sessions)
        .set({ revokedAt: new Date() })
        .where(eq(schema.sessions.id, row.id));
    });
    await audit(userId, 'auth.password_reset', 'user', userId, {});
    // No auto-login: the member proves the new password on the login screen.
    res.json({ ok: true });
  }),
);
