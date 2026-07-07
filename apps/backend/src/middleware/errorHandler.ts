/**
 * src/middleware/errorHandler.ts
 *
 * Central error handling middleware for DocuMind AI.
 *
 * WHY A CENTRAL ERROR HANDLER:
 *  Without a central handler, individual controllers must each handle their
 *  own errors, leading to inconsistent responses, accidental stack trace
 *  leakage, and no single place to add monitoring. Centralising means:
 *   - Consistent error shape across every endpoint
 *   - Stack traces NEVER reach the client in production
 *   - One place to hook in Sentry / Datadog / CloudWatch
 *
 * ERROR CLASSIFICATION:
 *  ZodError          → 400  (validation failed, safe to return field details)
 *  MulterError       → 400  (file upload error, safe message)
 *  AppError          → err.statusCode  (operational, crafted by our code)
 *  JsonWebTokenError → 401  (invalid token signature)
 *  TokenExpiredError → 401  (token past its expiry)
 *  PrismaClientKnownRequestError P2002 → 409  (unique constraint violation)
 *  Everything else   → 500  (unexpected — never expose internals)
 *
 * ADDING MONITORING:
 *  Replace the TODO comment in the 500 branch with:
 *    Sentry.captureException(err, { extra: { requestId, path: req.path } });
 *  or your preferred observability SDK.
 */

import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { JsonWebTokenError, TokenExpiredError } from 'jsonwebtoken';
import { Prisma } from '@prisma/client';
import multer from 'multer';

// ─────────────────────────────────────────────────────────────────────────────
// AppError — thrown by our own code for operational (expected) errors
// ─────────────────────────────────────────────────────────────────────────────

export class AppError extends Error {
  public readonly statusCode: number;
  /**
   * isOperational = true means we intentionally threw this error and the
   * message is safe to return to the client.
   */
  public readonly isOperational: boolean;

  constructor(message: string, statusCode: number, isOperational = true) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    // Restore prototype chain (TypeScript class extending Error quirk)
    Object.setPrototypeOf(this, new.target.prototype);
    Error.captureStackTrace(this, this.constructor);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Logging helper — replace console.error with Sentry.captureException etc.
// ─────────────────────────────────────────────────────────────────────────────

function logError(err: Error, req: Request, statusCode: number): void {
  const logEntry = {
    timestamp: new Date().toISOString(),
    level: statusCode >= 500 ? 'ERROR' : 'WARN',
    statusCode,
    method: req.method,
    path: req.path,
    ip: (req.headers['x-forwarded-for'] as string)?.split(',')[0].trim() ?? req.ip,
    errorName: err.name,
    message: err.message,
    // Stack logged server-side only — never sent to client
    ...(process.env.NODE_ENV !== 'production' && { stack: err.stack }),
  };

  if (statusCode >= 500) {
    console.error('[SERVER_ERROR]', JSON.stringify(logEntry));
    // TODO: Sentry.captureException(err, { extra: logEntry });
  } else {
    console.warn('[CLIENT_ERROR]', JSON.stringify(logEntry));
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Central error handler
// ─────────────────────────────────────────────────────────────────────────────

export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction
): void {
  // ── ZodError: validation failed ─────────────────────────────────────────
  if (err instanceof ZodError) {
    logError(err, req, 400);
    res.status(400).json({
      error: 'Validation failed',
      // Field-level errors so the client knows exactly which field to fix
      fields: err.issues.map((issue) => ({
        field:   issue.path.length > 0 ? issue.path.join('.') : 'unknown',
        message: issue.message,
        code:    issue.code,
      })),
    });
    return;
  }

  // ── MulterError: file upload issues ─────────────────────────────────────
  if (err instanceof multer.MulterError) {
    logError(err, req, 400);
    const messages: Record<string, string> = {
      LIMIT_FILE_SIZE:      'File is too large. Maximum size is 10MB.',
      LIMIT_FILE_COUNT:     'Too many files. Only one file per upload.',
      LIMIT_UNEXPECTED_FILE: 'Unexpected file field. Use the "file" field.',
    };
    res.status(400).json({
      error: 'File upload error',
      message: messages[err.code] ?? err.message,
    });
    return;
  }

  // ── JWT: invalid or expired token ────────────────────────────────────────
  if (err instanceof TokenExpiredError) {
    logError(err, req, 401);
    res.status(401).json({
      error: 'Token expired',
      message: 'Your session has expired. Please log in again.',
    });
    return;
  }

  if (err instanceof JsonWebTokenError) {
    logError(err, req, 401);
    res.status(401).json({
      error: 'Invalid token',
      message: 'Authentication token is invalid.',
    });
    return;
  }

  // ── Prisma: known DB errors ──────────────────────────────────────────────
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      // Unique constraint violation (e.g. duplicate email)
      logError(err, req, 409);
      const field = (err.meta?.target as string[])?.join(', ') ?? 'field';
      res.status(409).json({
        error: 'Conflict',
        message: `A record with this ${field} already exists.`,
      });
      return;
    }

    if (err.code === 'P2025') {
      // Record to update/delete not found
      logError(err, req, 404);
      res.status(404).json({
        error: 'Not found',
        message: 'The requested record does not exist.',
      });
      return;
    }
  }

  // ── AppError: operational errors thrown by our code ─────────────────────
  if (err instanceof AppError && err.isOperational) {
    logError(err, req, err.statusCode);
    res.status(err.statusCode).json({
      error: err.message,
    });
    return;
  }

  // ── Unknown / programmer errors ──────────────────────────────────────────
  // NEVER expose stack traces or internal error details to the client.
  // Log everything server-side for debugging.
  logError(err, req, 500);
  res.status(500).json({
    error: 'Internal server error',
    message: 'Something went wrong on our end. Please try again later.',
  });
}

