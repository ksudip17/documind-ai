/**
 * src/routes/auth.ts
 *
 * SECURITY LAYERS APPLIED:
 *  - authLimiter:       5 requests per 15 min per IP on login/register.
 *                       Protects against credential stuffing and brute force.
 *  - validate(schema):  Zod validation BEFORE database queries.
 *                       Rejects malformed input without hitting Prisma.
 */

import { Router } from 'express';
import { register, login, getMe } from '../controllers/auth';
import { authenticate } from '../middleware/auth';
import { authLimiter } from '../middleware/rateLimiter';
import { validate, registerSchema, loginSchema } from '../validation/schemas';

const router = Router();

// POST /api/auth/register — rate limited + validated
router.post('/register', authLimiter, validate(registerSchema), register);

// POST /api/auth/login — rate limited + validated
router.post('/login', authLimiter, validate(loginSchema), login);

// GET /api/auth/me — JWT required, no rate limit (general limiter covers it)
router.get('/me', authenticate, getMe);

export default router;

