import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { config } from '../config.js';
import { ApiError } from './errors.js';

export { hashPassword, verifyPassword } from '@aglotrends/database';

export type Role = 'MEMBER' | 'ADMIN' | 'SUPERADMIN';

export interface AuthUser {
  id: string;
  role: Role;
  jti: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
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

/** Staff = ADMIN or SUPERADMIN. */
export const requireStaff = requireRole('ADMIN', 'SUPERADMIN');
/** Only SUPERADMIN may change roles / manage staff. */
export const requireSuperAdmin = requireRole('SUPERADMIN');
