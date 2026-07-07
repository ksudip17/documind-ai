/**
 * src/routes/query.ts
 *
 * SECURITY LAYERS APPLIED:
 *  - authenticate:      JWT required on all routes.
 *  - queryLimiter:      30 AI queries per hour per IP.
 *                       Each query invokes Groq (paid LLM) + pgvector search.
 *                       Tighter limit than general to control cost.
 *  - searchLimiter:     100 reads per hour on history endpoint.
 *  - validate(schema):  Zod validates question length + documentId UUID.
 *                       Prevents oversized prompts from reaching the LLM.
 */

import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { query, getQueryHistory } from '../controllers/query';
import { queryLimiter, searchLimiter } from '../middleware/rateLimiter';
import {
  validate,
  querySchema,
  queryHistoryParamsSchema,
} from '../validation/schemas';

const router = Router();

// All query routes require authentication
router.use(authenticate);

// POST /api/query — rate limited (LLM cost control) + validated
router.post('/', queryLimiter, validate(querySchema), query);

// GET /api/query/history/:documentId — validate UUID param, search limited
router.get(
  '/history/:documentId',
  searchLimiter,
  validate(queryHistoryParamsSchema, 'params'),
  getQueryHistory
);

export default router;

