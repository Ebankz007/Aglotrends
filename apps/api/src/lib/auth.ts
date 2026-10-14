import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { eq } from 'drizzle-orm';
import { config } from '../config.js';
import { db, schema } from '../db.js';
import { ApiError } from './errors.js';
import {
  canManage,
  canView,
  normalizePermissionMap,
  type AdminArea,
  type PermissionLevel,
} from './permissions.js';

export { hashPassword, verifyPassword } from '@aglotrends/database';

export type Role = 'MEMBER' | 'ADMIN' | 'SUPERADMIN';

export interface AuthUser {
  id: string;
  role: Role;
  jti: string;
}

/**
 * The live staff record for the current request, loaded from the database
 * rather than trusted from the token. A JWT is a snapshot: if it carried the
 * role and permissions, revoking someone's access would not take effect until
 * their token expired. For an access-control feature that is the wrong trade,
 * so every admin request re-reads the row.
 */
export interface StaffContext {
  id: string;
  role: Role;
  permissions: Partial<Record<AdminArea, PermissionLevel>>;
  viewOnly: boolean;
  twoFactorEnabled: boolean;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
      staff?: StaffContext;
    }
  }
}

export function signToken(user: { id: string; role: Role }): string {
  return jwt.sign({ sub: user.id, role: user.role }, config.JWT_SECRET, {
    expiresIn: `${config.SESSION_TTL_HOURS}h`,
    jwtid: randomUUID(),
  });
}

export function verifyToken(token: string): AuthUser {
  const decoded = jwt.verify(token, config.JWT_SECRET);
  if (typeof decoded === 'string' || !decoded.sub) {
    throw ApiError.unauthorized('Invalid token');
  }
  return { id: String(decoded.sub), role: decoded.role as Role, jti: String(decoded.jti ?? '') };
}

/* ------------------------------------------------- two-factor login challenge */

/**
 * A password alone does not earn a session when the account has 2FA enabled.
 * Instead the password step returns one of these: a short-lived, single-purpose
 * token that is only good for presenting the second factor. It is deliberately
 * not a session token — `requireAuth` rejects it because it carries no role, and
 * the TTL is minutes, not hours.
 */
const CHALLENGE_TTL_MINUTES = 5;

export function signChallengeToken(userId: string): string {
  return jwt.sign({ sub: userId, purpose: '2fa' }, config.JWT_SECRET, {
    expiresIn: `${CHALLENGE_TTL_MINUTES}m`,
    jwtid: randomUUID(),
  });
}

export function verifyChallengeToken(token: string): string {
  let decoded: string | jwt.JwtPayload;
  try {
    decoded = jwt.verify(token, config.JWT_SECRET);
  } catch {
    throw ApiError.unauthorized('The verification window expired. Sign in again.');
  }
  if (typeof decoded === 'string' || !decoded.sub || decoded.purpose !== '2fa') {
    throw ApiError.unauthorized('Invalid verification token');
  }
  return String(decoded.sub);
}

/* ------------------------------------------------------------------ session */

/**
 * The session token travels two ways, on purpose:
 *  - `Authorization: Bearer <jwt>` — for API clients, scripts, and mobile.
 *  - an httpOnly cookie — for the web app, so JavaScript never touches the
 *    token and an XSS cannot exfiltrate it (the COPINEX lesson, kept).
 * The cookie is set on login/register and cleared on logout.
 */
export const SESSION_COOKIE = 'aglotrends_session';

export function readSessionCookie(req: Request): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === SESSION_COOKIE) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return null;
}

export function setSessionCookie(res: Response, token: string): void {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.NODE_ENV === 'production',
    maxAge: config.SESSION_TTL_HOURS * 60 * 60 * 1000,
    path: '/',
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, { path: '/' });
}

export const requireAuth: RequestHandler = (req, _res, next) => {
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice(7) : readSessionCookie(req);
  if (!token) {
    next(ApiError.unauthorized('Missing session'));
    return;
  }
  try {
    req.user = verifyToken(token);
    next();
  } catch {
    next(ApiError.unauthorized('Invalid or expired token'));
  }
};

export function requireRole(...roles: Role[]): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) {
      next(ApiError.unauthorized());
      return;
    }
    if (!roles.includes(req.user.role)) {
      next(ApiError.forbidden('Insufficient role'));
      return;
    }
    next();
  };
}

/* -------------------------------------------------------------------- staff */

async function loadStaffContext(userId: string): Promise<StaffContext> {
  const [row] = await db
    .select({
      id: schema.users.id,
      role: schema.users.role,
      status: schema.users.status,
      permissions: schema.users.permissions,
      viewOnly: schema.users.viewOnly,
      twoFactorEnabled: schema.users.twoFactorEnabled,
    })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);

  if (!row) throw ApiError.unauthorized('Account no longer exists');
  if (row.status === 'SUSPENDED') throw ApiError.forbidden('Account suspended');
  if (row.role !== 'ADMIN' && row.role !== 'SUPERADMIN') {
    throw ApiError.forbidden('Staff access required');
  }

  return {
    id: row.id,
    role: row.role,
    permissions: normalizePermissionMap(row.permissions),
    viewOnly: row.viewOnly,
    twoFactorEnabled: row.twoFactorEnabled,
  };
}

/**
 * Staff = ADMIN or SUPERADMIN, verified against the database on every request,
 * and gated on two-factor enrolment.
 *
 * The 2FA gate lives here rather than in a separate middleware so it cannot be
 * forgotten on a new route: any handler that admits staff admits only staff who
 * have enrolled. Enrolment itself is served from /api/auth/2fa, which sits
 * behind `requireAuth` alone — otherwise a staff member could never enrol.
 *
 * A SUPERADMIN bypasses the *permission* layer entirely (see `requirePermission`)
 * but not this gate. Everyone uses a second factor.
 */
export const requireStaff: RequestHandler = (req, _res, next) => {
  // Idempotent: several admin routers are mounted on the same path, so this
  // runs more than once per request. Resolve the staff row once.
  if (req.staff) {
    next();
    return;
  }
  const authUser = req.user;
  if (!authUser) {
    next(ApiError.unauthorized());
    return;
  }
  loadStaffContext(authUser.id)
    .then((staff) => {
      if (!staff.twoFactorEnabled) {
        next(
          ApiError.forbidden(
            'Two-factor authentication must be enabled before using the admin console',
            'TWO_FACTOR_REQUIRED',
          ),
        );
        return;
      }
      req.staff = staff;
      next();
    })
    .catch(next);
};

/**
 * Area gate. `SUPERADMIN` returns before any check — that bypass is structural,
 * not a grant that can be edited away, so a misconfigured permission map can
 * never lock a superadmin out of their own console.
 */
export function requirePermission(
  area: AdminArea,
  level: 'VIEW' | 'MANAGE' = 'VIEW',
): RequestHandler {
  return (req, _res, next) => {
    const staff = req.staff;
    if (!staff) {
      next(ApiError.forbidden('Staff access required'));
      return;
    }
    if (staff.role === 'SUPERADMIN') {
      next();
      return;
    }
    const allowed =
      level === 'MANAGE'
        ? canManage(staff.permissions, staff.viewOnly, area)
        : canView(staff.permissions, staff.viewOnly, area);
    if (!allowed) {
      next(
        ApiError.forbidden(
          `You do not have ${level === 'MANAGE' ? 'manage' : 'view'} access to this area`,
          'AREA_FORBIDDEN',
        ),
      );
      return;
    }
    next();
  };
}

/** Only SUPERADMIN may change roles, permissions, or manage staff. */
export const requireSuperAdmin: RequestHandler = (req, _res, next) => {
  const role = req.staff?.role ?? req.user?.role;
  if (!role) {
    next(ApiError.unauthorized());
    return;
  }
  if (role !== 'SUPERADMIN') {
    next(ApiError.forbidden('Superadmin only'));
    return;
  }
  next();
};

/**
 * Membership activation gate. Staff always pass. A MEMBER passes only when the
 * §1 fee has settled (`isActiveMember`) — until then the client area is the
 * wallet (to settle the fee), support, and settings; everything else 403s with
 * ACTIVATION_REQUIRED so the client can route to the wallet, not to login.
 *
 * `isActiveMember` is read from the database, not the token, so an activation
 * takes effect on the very next request without re-login.
 */
export const requireActiveMember: RequestHandler = (req, _res, next) => {
  const authUser = req.user;
  if (!authUser) {
    next(ApiError.unauthorized());
    return;
  }
  if (authUser.role !== 'MEMBER') {
    next();
    return;
  }
  db.select({ isActiveMember: schema.users.isActiveMember })
    .from(schema.users)
    .where(eq(schema.users.id, authUser.id))
    .limit(1)
    .then(([row]) => {
      if (!row) {
        next(ApiError.unauthorized('Account no longer exists'));
        return;
      }
      if (!row.isActiveMember) {
        next(
          ApiError.forbidden(
            'Membership activation required — settle the registration fee to unlock this area.',
            'ACTIVATION_REQUIRED',
          ),
        );
        return;
      }
      next();
    })
    .catch(next);
};
