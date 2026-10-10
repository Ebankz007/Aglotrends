import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { logger } from '../logger.js';

/** An error with an HTTP status. Thrown anywhere; rendered by the error handler. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  static badRequest(message: string, code?: string) {
    return new ApiError(400, message, code);
  }
  static unauthorized(message = 'Unauthorized', code?: string) {
    return new ApiError(401, message, code);
  }
  static forbidden(message = 'Forbidden', code?: string) {
    return new ApiError(403, message, code);
  }
  static notFound(message = 'Not found', code?: string) {
    return new ApiError(404, message, code);
  }
  static conflict(message: string, code?: string) {
    return new ApiError(409, message, code);
  }
}

export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({ error: 'Not found' });
}

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof ApiError) {
    res.status(err.status).json({ error: err.message, code: err.code });
    return;
  }
  if (err instanceof ZodError) {
    res.status(400).json({ error: 'Validation failed', issues: err.flatten() });
    return;
  }
  logger.error({ err }, 'Unhandled error');
  res.status(500).json({ error: 'Internal server error' });
}
