import { describe, expect, it } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import { z, ZodError } from 'zod';
import { ApiError, errorHandler, notFoundHandler } from '../src/lib/errors.js';

function mockRes(): Response & { statusCode: number; body: unknown } {
  const res = {
    statusCode: 0,
    body: undefined as unknown,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(payload: unknown) {
      res.body = payload;
      return res;
    },
  };
  return res as unknown as Response & { statusCode: number; body: unknown };
}

const noop: NextFunction = () => {};

describe('ApiError', () => {
  it('sets status, message, and code on the static constructors', () => {
    expect(ApiError.badRequest('bad', 'BAD').status).toBe(400);
    expect(ApiError.unauthorized().status).toBe(401);
    expect(ApiError.forbidden().status).toBe(403);
    expect(ApiError.notFound().status).toBe(404);
    expect(ApiError.conflict('dup', 'DUP').code).toBe('DUP');
  });

  it('defaults unauthorized/forbidden/notFound messages', () => {
    expect(ApiError.unauthorized().message).toBe('Unauthorized');
    expect(ApiError.forbidden().message).toBe('Forbidden');
    expect(ApiError.notFound().message).toBe('Not found');
  });
});

describe('errorHandler', () => {
  it('renders an ApiError with its status and code', () => {
    const res = mockRes();
    errorHandler(ApiError.conflict('Email taken', 'EMAIL_TAKEN'), {} as Request, res, noop);
    expect(res.statusCode).toBe(409);
    expect(res.body).toEqual({ error: 'Email taken', code: 'EMAIL_TAKEN' });
  });

  it('renders a ZodError as a 400 with flattened issues', () => {
    const res = mockRes();
    let zodErr: unknown;
    try {
      z.object({ email: z.string().email() }).parse({ email: 'nope' });
    } catch (e) {
      zodErr = e;
    }
    expect(zodErr).toBeInstanceOf(ZodError);
    errorHandler(zodErr, {} as Request, res, noop);
    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ error: 'Validation failed' });
  });

  it('renders an unknown error as a 500 without leaking the message', () => {
    const res = mockRes();
    errorHandler(new Error('secret internal detail'), {} as Request, res, noop);
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: 'Internal server error' });
  });
});

describe('notFoundHandler', () => {
  it('returns 404 with a generic body', () => {
    const res = mockRes();
    notFoundHandler({} as Request, res);
    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ error: 'Not found' });
  });
});
