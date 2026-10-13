/**
 * Two-factor authentication (TOTP) — enrolment, verification, and recovery.
 *
 * Mounted at `/api/auth/2fa`, behind `requireAuth` alone for the enrolment
 * routes. That is deliberate: `requireStaff` refuses staff who have not
 * enrolled, so if enrolment also required staff access nobody could ever
 * enrol. The login-challenge route (`/verify`) is public by necessity — the
 * caller has a password and a challenge token, not a session.
 */
import { Router } from 'express';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import QRCode from 'qrcode';
import { db, schema } from '../db.js';
import { asyncHandler } from '../lib/async.js';
import { ApiError } from '../lib/errors.js';
import { decryptSecret, encryptSecret } from '../lib/crypto.js';
import {
  requireAuth,
  setSessionCookie,
  signToken,
  verifyChallengeToken,
  verifyPassword,
} from '../lib/auth.js';
import {
  buildOtpauthUri,
  generateRecoveryCodes,
  generateTotpSecret,
  hashRecoveryCode,
  matchRecoveryCode,
  verifyTotpCode,
} from '../lib/totp.js';
import { publicUser } from '../lib/user-view.js';
import { audit } from '../services/audit.js';

export const twoFactorRouter = Router();

type UserRow = typeof schema.users.$inferSelect;

const ISSUER = 'Aglotrends';
const RECOVERY_CODE_COUNT = 10;

async function loadUser(userId: string): Promise<UserRow> {
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, userId)).limit(1);
  if (!user) throw ApiError.unauthorized('Account no longer exists');
  return user;
}

/**
 * Accepts either a 6-digit authenticator code or a recovery code, and consumes
 * a recovery code on use so it cannot be replayed. The two are told apart by
 * shape: a normalised recovery code is 16 hex characters, a TOTP is 6 digits.
 */
async function consumeSecondFactor(user: UserRow, code: string): Promise<boolean> {
  const compact = code.replace(/[\s-]/g, '');

  if (/^[0-9a-f]{16}$/i.test(compact)) {
    const index = matchRecoveryCode(code, user.twoFactorRecoveryCodes);
    if (index === -1) return false;
    const remaining = user.twoFactorRecoveryCodes.filter((_, i) => i !== index);
    await db
      .update(schema.users)
      .set({ twoFactorRecoveryCodes: remaining, updatedAt: new Date() })
      .where(eq(schema.users.id, user.id));
    await audit(user.id, 'auth.2fa.recovery_used', 'user', user.id, {
      remaining: remaining.length,
    });
    return true;
  }

  if (!user.twoFactorSecret) return false;
  return verifyTotpCode(decryptSecret(user.twoFactorSecret), code);
}

/* ------------------------------------------------------------------ status */

twoFactorRouter.get(
  '/status',
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = await loadUser(req.user!.id);
    res.json({
      enabled: user.twoFactorEnabled,
      enrolledAt: user.twoFactorEnrolledAt,
      recoveryCodesRemaining: user.twoFactorRecoveryCodes.length,
    });
  }),
);

/* --------------------------------------------------------------- enrolment */

/**
 * Begins enrolment: mints a secret, stores it encrypted, and returns the QR.
 * The account is *not* protected yet — `twoFactorEnabled` stays false until the
 * user proves they can produce a code, which is what `/enable` checks.
 */
twoFactorRouter.post(
  '/setup',
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = await loadUser(req.user!.id);
    if (user.twoFactorEnabled) {
      throw ApiError.conflict(
        'Two-factor authentication is already enabled',
        'TWO_FACTOR_ALREADY_ENABLED',
      );
    }

    const secret = generateTotpSecret();
    await db
      .update(schema.users)
      .set({ twoFactorSecret: encryptSecret(secret), updatedAt: new Date() })
      .where(eq(schema.users.id, user.id));

    const otpauthUri = buildOtpauthUri({ secret, account: user.email, issuer: ISSUER });
    const qrDataUrl = await QRCode.toDataURL(otpauthUri, {
      margin: 1,
      width: 220,
      color: { dark: '#010b1a', light: '#ffffff' },
    });

    res.json({ secret, otpauthUri, qrDataUrl });
  }),
);

/* ---------------------------------------------------------------- confirm */

const enableSchema = z.object({ code: z.string().min(6).max(12) });

twoFactorRouter.post(
  '/enable',
  requireAuth,
  asyncHandler(async (req, res) => {
    const body = enableSchema.parse(req.body);
    const user = await loadUser(req.user!.id);

    if (user.twoFactorEnabled) {
      throw ApiError.conflict('Two-factor authentication is already enabled', 'TWO_FACTOR_ALREADY_ENABLED');
    }
    if (!user.twoFactorSecret) {
      throw ApiError.badRequest('Start enrolment before confirming a code', 'TWO_FACTOR_NOT_STARTED');
    }

    const secret = decryptSecret(user.twoFactorSecret);
    if (!verifyTotpCode(secret, body.code)) {
      throw ApiError.badRequest(
        'That code is not valid. Check your device clock and try again.',
        'TWO_FACTOR_INVALID_CODE',
      );
    }

    const recoveryCodes = generateRecoveryCodes(RECOVERY_CODE_COUNT);
    await db
      .update(schema.users)
      .set({
        twoFactorEnabled: true,
        twoFactorEnrolledAt: new Date(),
        twoFactorRecoveryCodes: recoveryCodes.map(hashRecoveryCode),
        updatedAt: new Date(),
      })
      .where(eq(schema.users.id, user.id));

    await audit(user.id, 'auth.2fa.enabled', 'user', user.id, {});
    // Returned exactly once. Only hashes are stored from here on.
    res.json({ enabled: true, recoveryCodes });
  }),
);

/* ---------------------------------------------------------------- disable */

const disableSchema = z.object({ password: z.string().min(1), code: z.string().min(1) });

twoFactorRouter.post(
  '/disable',
  requireAuth,
  asyncHandler(async (req, res) => {
    const body = disableSchema.parse(req.body);
    const user = await loadUser(req.user!.id);

    if (!user.twoFactorEnabled) {
      throw ApiError.badRequest('Two-factor authentication is not enabled', 'TWO_FACTOR_NOT_ENABLED');
    }
    // Password *and* a second factor: turning 2FA off is itself a security
    // downgrade, so it takes both factors to authorise.
    if (!verifyPassword(body.password, user.passwordHash)) {
      throw ApiError.unauthorized('Password is incorrect');
    }
    if (!(await consumeSecondFactor(user, body.code))) {
      throw ApiError.badRequest('That code is not valid', 'TWO_FACTOR_INVALID_CODE');
    }

    await db
      .update(schema.users)
      .set({
        twoFactorEnabled: false,
        twoFactorSecret: null,
        twoFactorRecoveryCodes: [],
        twoFactorEnrolledAt: null,
        updatedAt: new Date(),
      })
      .where(eq(schema.users.id, user.id));

    await audit(user.id, 'auth.2fa.disabled', 'user', user.id, {});
    res.json({ enabled: false });
  }),
);

/* ------------------------------------------------------------- regenerate */

const regenerateSchema = z.object({ code: z.string().min(6).max(12) });

twoFactorRouter.post(
  '/recovery-codes',
  requireAuth,
  asyncHandler(async (req, res) => {
    const body = regenerateSchema.parse(req.body);
    const user = await loadUser(req.user!.id);

    if (!user.twoFactorEnabled || !user.twoFactorSecret) {
      throw ApiError.badRequest('Two-factor authentication is not enabled', 'TWO_FACTOR_NOT_ENABLED');
    }
    // An authenticator code specifically — a recovery code must not be able to
    // mint a fresh set, or one leaked code would refresh the whole batch.
    if (!verifyTotpCode(decryptSecret(user.twoFactorSecret), body.code)) {
      throw ApiError.badRequest('Enter a valid authenticator code', 'TWO_FACTOR_INVALID_CODE');
    }

    const recoveryCodes = generateRecoveryCodes(RECOVERY_CODE_COUNT);
    await db
      .update(schema.users)
      .set({ twoFactorRecoveryCodes: recoveryCodes.map(hashRecoveryCode), updatedAt: new Date() })
      .where(eq(schema.users.id, user.id));

    await audit(user.id, 'auth.2fa.recovery_regenerated', 'user', user.id, {});
    res.json({ recoveryCodes });
  }),
);

/* --------------------------------------------------------- login challenge */

const verifySchema = z.object({ challengeToken: z.string().min(1), code: z.string().min(1) });

/**
 * Step two of login. Exchanges a valid challenge token plus a second factor for
 * a real session. The challenge token is short-lived and single-purpose, so a
 * stolen password alone still buys nothing.
 */
twoFactorRouter.post(
  '/verify',
  asyncHandler(async (req, res) => {
    const body = verifySchema.parse(req.body);
    const userId = verifyChallengeToken(body.challengeToken);
    const user = await loadUser(userId);

    if (user.status === 'SUSPENDED') throw ApiError.forbidden('Account suspended');
    if (!user.twoFactorEnabled) {
      throw ApiError.badRequest('Two-factor authentication is not enabled', 'TWO_FACTOR_NOT_ENABLED');
    }

    if (!(await consumeSecondFactor(user, body.code))) {
      await audit(user.id, 'auth.2fa.failed', 'user', user.id, {});
      throw ApiError.unauthorized('That code is not valid', 'TWO_FACTOR_INVALID_CODE');
    }

    await db.update(schema.users).set({ lastLoginAt: new Date() }).where(eq(schema.users.id, user.id));
    const token = signToken({ id: user.id, role: user.role });
    setSessionCookie(res, token);
    await audit(user.id, 'auth.login', 'user', user.id, { method: 'two_factor' });

    res.json({ token, user: publicUser(user) });
  }),
);
