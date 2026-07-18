/**
 * src/validation/schemas.ts
 *
 * Centralised Zod schemas for every mutating endpoint.
 *
 * WHY ZOD:
 *  - Validates request data BEFORE it ever reaches a database query or
 *    business-logic layer, preventing injection, unexpected types, and
 *    oversized payloads from propagating inward.
 *  - Returns typed, field-level errors so the client knows exactly which
 *    field to fix instead of receiving a generic 400.
 *
 * USAGE:
 *  import { validate, registerSchema } from '../validation/schemas';
 *  router.post('/register', validate(registerSchema), register);
 */

import { z } from 'zod';
import { Request, Response, NextFunction } from 'express';

// ─────────────────────────────────────────────────────────────────────────────
// Reusable primitives
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Prisma document/query ID — Prisma generates CUID v1 by default
 * (e.g. cmrqehyzj00069z9ctseq2qsa). The old z.string().uuid() schema
 * rejected every valid document ID because UUIDs and CUIDs are different
 * formats, causing every GET/DELETE /documents/:id request to return 400.
 *
 * Accepts both CUID (Prisma default) and UUID (future-proof) formats.
 * Still blocks arbitrary string injection — only well-formed DB-generated
 * IDs pass validation.
 */
const dbId = z
  .string()
  .regex(
    /^[a-z0-9]{20,36}$|^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    'Must be a valid document ID'
  );

/**
 * Normalised email: trim whitespace, force lowercase.
 * Lowercasing prevents "User@Example.com" ≠ "user@example.com" account dupes.
 */
const email = z
  .string()
  .trim()
  .toLowerCase()
  .email('Must be a valid email address')
  .max(254, 'Email must be at most 254 characters'); // RFC 5321 limit

// ─────────────────────────────────────────────────────────────────────────────
// AUTH SCHEMAS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/auth/register
 *
 * Password rules enforce a minimum security baseline:
 *  - At least 8 chars (NIST SP 800-63B minimum)
 *  - At most 128 chars (prevents bcrypt DoS via extremely long passwords)
 *  - Must contain uppercase, lowercase, digit, and special char
 */
export const registerSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, 'Name must be at least 2 characters')
    .max(50, 'Name must be at most 50 characters')
    .regex(/^[\p{L}\p{M} '-]+$/u, 'Name contains invalid characters'),

  email,

  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(128, 'Password must be at most 128 characters')
    .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
    .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
    .regex(/[0-9]/, 'Password must contain at least one number')
    .regex(
      /[^A-Za-z0-9]/,
      'Password must contain at least one special character'
    ),
});

/**
 * POST /api/auth/login
 *
 * Intentionally lenient on format — we validate existence in DB, not shape,
 * so we only enforce non-empty and reasonable max lengths to prevent oversized
 * payloads from reaching bcrypt.compareSync.
 */
export const loginSchema = z.object({
  email,
  password: z
    .string()
    .min(1, 'Password is required')
    .max(128, 'Password must be at most 128 characters'),
});

// ─────────────────────────────────────────────────────────────────────────────
// QUERY SCHEMAS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/query
 *
 * question: bounded to prevent absurdly large prompts that would blow out
 *   token limits and cost on the Groq API.
 * documentId: must be a valid UUID — prevents traversal to arbitrary documents.
 */
export const querySchema = z.object({
  question: z
    .string()
    .trim()
    .min(3, 'Question must be at least 3 characters')
    .max(500, 'Question must be at most 500 characters'),

  documentId: dbId,
});

/**
 * GET /api/query/history/:documentId  (route param)
 *
 * Validates the :documentId URL parameter is a valid UUID before the DB query.
 */
export const queryHistoryParamsSchema = z.object({
  documentId: dbId,
});

// ─────────────────────────────────────────────────────────────────────────────
// DOCUMENT SCHEMAS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/documents/:id  (route param)
 * DELETE /api/documents/:id  (route param)
 */
export const documentIdParamSchema = z.object({
  id: dbId,
});

// ─────────────────────────────────────────────────────────────────────────────
// MIDDLEWARE FACTORY
// ─────────────────────────────────────────────────────────────────────────────

type SchemaTarget = 'body' | 'params' | 'query';

/**
 * validate(schema, target?)
 *
 * Returns an Express middleware that:
 *  1. Parses req[target] through the given Zod schema
 *  2. On success — replaces req[target] with the parsed (sanitised) data and
 *     calls next()
 *  3. On failure — calls next(error) where error is a ZodError, which the
 *     central errorHandler will format as a 400 with per-field messages
 *
 * Defaulting to 'body' covers POST/PUT endpoints. Pass 'params' for :id
 * route params and 'query' for GET query strings.
 */
export function validate(
  schema: z.ZodTypeAny,
  target: SchemaTarget = 'body'
) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req[target]);

    if (!result.success) {
      // Forward the ZodError to the central error handler
      next(result.error);
      return;
    }

    // Replace with parsed (trimmed / lowercased / coerced) data
    // This ensures downstream code works with clean values
    // Cast through unknown first — TypeScript requires this when the types
    // are mutually incompatible but we know the assignment is safe
    (req as unknown as Record<string, unknown>)[target] = result.data;
    next();
  };
}
