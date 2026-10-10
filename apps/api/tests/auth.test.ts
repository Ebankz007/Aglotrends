import { describe, expect, it } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import {
  SESSION_COOKIE,
  readSessionCookie,
  requireAuth,
  signToken,
  verifyToken,
} from '../src/lib/auth.js';
import { ApiError } from '../src/lib/errors.js';

function mockReq(headers: Record<string, string> = {}): Request {
  return { headers } as unknown as Request;
}

function mockNext(): { calls: unknown[]; fn: NextFunction } {
  const calls: unknown[] = [];
  const fn = ((err?: unknown) => {
    calls.push(err);
  }) as NextFunction;
  return { calls, fn };
}

describe('readSessionCookie', () => {
  it('returns null when there is no cookie header', () => {
    expect(readSessionCookie(mockReq())).toBeNull();
  });

  it('extracts the session cookie from a single-cookie header', () => {
    expect(readSessionCookie(mockReq({ cookie: `${SESSION_COOKIE}=abc.def.ghi` }))).toBe('abc.def.ghi');
  });

  it('finds the session cookie among several cookies', () => {
    const header = `theme=dark; ${SESSION_COOKIE}=tok123; locale=en`;
    expect(readSessionCookie(mockReq({ cookie: header }))).toBe('tok123');
  });

  it('decodes a URI-encoded cookie value', () => {
    expect(readSessionCookie(mockReq({ cookie: `${SESSION_COOKIE}=a%2Bb%3Dc` }))).toBe('a+b=c');
  });

  it('ignores a cookie with no value separator', () => {
    expect(readSessionCookie(mockReq({ cookie: 'malformed; theme=dark' }))).toBeNull();
  });
});

describe('signToken / verifyToken', () => {
  it('round-trips the user id and role', () => {
    const token = signToken({ id: 'user-1', role: 'ADMIN' });
    const decoded = verifyToken(token);
    expect(decoded.id).toBe('user-1');
    expect(decoded.role).toBe('ADMIN');
    expect(decoded.jti).not.toBe('');
  });

  it('rejects a garbage token', () => {
    expect(() => verifyToken('not-a-jwt')).toThrow();
  });

  it('rejects a token signed with a different secret', () => {
    // A structurally valid JWT whose signature does not match our secret.
    const foreign =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ4Iiwicm9sZSI6Ik1FTUJFUiJ9.aaaa';
    expect(() => verifyToken(foreign)).toThrow();
  });
});

describe('requireAuth', () => {
  it('401s when there is no bearer token and no cookie', () => {
    const next = mockNext();
    requireAuth(mockReq(), {} as Response, next.fn);
    expect(next.calls[0]).toBeInstanceOf(ApiError);
    expect((next.calls[0] as ApiError).status).toBe(401);
  });

  it('accepts a valid bearer token and populates req.user', () => {
    const token = signToken({ id: 'bearer-user', role: 'MEMBER' });
    const req = mockReq({ authorization: `Bearer ${token}` });
    const next = mockNext();
    requireAuth(req, {} as Response, next.fn);
    expect(req.user?.id).toBe('bearer-user');
    expect(next.calls[0]).toBeUndefined();
  });

  it('accepts a valid session cookie when there is no bearer token', () => {
    const token = signToken({ id: 'cookie-user', role: 'SUPERADMIN' });
    const req = mockReq({ cookie: `${SESSION_COOKIE}=${token}` });
    const next = mockNext();
    requireAuth(req, {} as Response, next.fn);
    expect(req.user?.id).toBe('cookie-user');
    expect(req.user?.role).toBe('SUPERADMIN');
    expect(next.calls[0]).toBeUndefined();
  });

  it('401s on an invalid bearer token', () => {
    const req = mockReq({ authorization: 'Bearer garbage' });
    const next = mockNext();
    requireAuth(req, {} as Response, next.fn);
    expect(next.calls[0]).toBeInstanceOf(ApiError);
    expect((next.calls[0] as ApiError).status).toBe(401);
  });
});
