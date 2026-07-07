/**
 * src/middleware/rateLimiter.ts
 *
 * Distributed, Redis-backed rate limiting using `rate-limiter-flexible`.
 *
 * WHY RATE-LIMITER-FLEXIBLE OVER EXPRESS-RATE-LIMIT:
 *  - express-rate-limit stores counters IN MEMORY per process. In a PM2
 *    cluster or multi-instance EC2 setup, each process has its own counter,
 *    so a user can multiply their allowed requests by the number of instances.
 *  - rate-limiter-flexible writes counters to Redis, making the limit truly
 *    distributed and consistent regardless of how many processes are running.
 *
 * STRATEGIES:
 *  ┌─────────────────────┬──────────┬──────────┬──────────────────────────────┐
 *  │ Limiter             │ Window   │ Max Hits │ Endpoints                    │
 *  ├─────────────────────┼──────────┼──────────┼──────────────────────────────┤
 *  │ authLimiter         │ 15 min   │ 5        │ POST /auth/login, /register  │
 *  │ uploadLimiter       │ 15 min   │ 10       │ POST /documents/upload       │
 *  │ queryLimiter        │ 1 hour   │ 30       │ POST /query                  │
 *  │ searchLimiter       │ 1 hour   │ 100      │ GET /documents, /history     │
 *  │ generalLimiter      │ 1 hour   │ 1000     │ All routes (global fallback) │
 *  └─────────────────────┴──────────┴──────────┴──────────────────────────────┘
 *
 * IP EXTRACTION:
 *  Uses x-forwarded-for first (set by Nginx reverse proxy) then req.ip.
 *  The `app.set('trust proxy', 1)` in index.ts makes req.ip reliable behind Nginx.
 */

import { RateLimiterRedis, RateLimiterRes } from 'rate-limiter-flexible';
import { Request, Response, NextFunction } from 'express';
import { redis } from '../config/redis';

// ─────────────────────────────────────────────────────────────────────────────
// IP helper
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extract the real client IP from the request.
 * x-forwarded-for may contain a comma-separated list (client, proxy1, proxy2).
 * We take the first element which is the original client IP.
 */
function getClientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    const ips = Array.isArray(forwarded) ? forwarded[0] : forwarded;
    return ips.split(',')[0].trim();
  }
  return req.ip || req.socket.remoteAddress || 'unknown';
}

// ─────────────────────────────────────────────────────────────────────────────
// Limiter instances
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Auth limiter — 5 attempts per 15 minutes per IP.
 * Protects against brute-force credential stuffing on login/register.
 * Key prefix 'rl:auth' isolates this counter from others in Redis.
 */
const authLimiterInstance = new RateLimiterRedis({
  storeClient: redis,
  keyPrefix: 'rl:auth',
  points: 5,              // max requests
  duration: 15 * 60,     // per 15 minutes (seconds)
  blockDuration: 15 * 60, // block for 15 min after limit reached
});

/**
 * Upload limiter — 10 uploads per 15 minutes per IP.
 * Prevents abuse of the BullMQ queue and Supabase Storage bandwidth.
 */
const uploadLimiterInstance = new RateLimiterRedis({
  storeClient: redis,
  keyPrefix: 'rl:upload',
  points: 10,
  duration: 15 * 60,
  blockDuration: 15 * 60,
});

/**
 * Query limiter — 30 AI queries per hour per IP.
 * Each query hits the Groq API (paid) and runs a pgvector similarity search.
 * Tighter than the general limit to control LLM cost.
 */
const queryLimiterInstance = new RateLimiterRedis({
  storeClient: redis,
  keyPrefix: 'rl:query',
  points: 30,
  duration: 60 * 60,     // per hour
  blockDuration: 60 * 60,
});

/**
 * Search limiter — 100 read requests per hour per IP.
 * Covers GET /documents and GET /query/history/:id.
 */
const searchLimiterInstance = new RateLimiterRedis({
  storeClient: redis,
  keyPrefix: 'rl:search',
  points: 100,
  duration: 60 * 60,
  blockDuration: 60 * 60,
});

/**
 * General limiter — 1000 requests per hour per IP.
 * Applied globally as the last line of defence.
 */
const generalLimiterInstance = new RateLimiterRedis({
  storeClient: redis,
  keyPrefix: 'rl:general',
  points: 1000,
  duration: 60 * 60,
  blockDuration: 60 * 60,
});

// ─────────────────────────────────────────────────────────────────────────────
// Middleware factory
// ─────────────────────────────────────────────────────────────────────────────

/**
 * createRateLimitMiddleware
 *
 * Wraps a RateLimiterRedis instance in Express middleware.
 *
 * On success: calls next()
 * On limit exceeded: responds 429 with:
 *   - Retry-After header (seconds until the window resets)
 *   - X-RateLimit-Limit header (max points)
 *   - X-RateLimit-Remaining header (0 when blocked)
 *   - X-RateLimit-Reset header (Unix timestamp of window reset)
 *   - JSON body with human-readable message
 * On Redis error: FAIL OPEN — calls next() to avoid a Redis outage taking
 *   down the entire API. Log the error for monitoring.
 */
function createRateLimitMiddleware(
  limiter: RateLimiterRedis,
  limiterName: string
) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const ip = getClientIp(req);

    try {
      const result = await limiter.consume(ip);

      // Attach rate limit info headers on successful requests
      res.setHeader('X-RateLimit-Limit', limiter.points);
      res.setHeader('X-RateLimit-Remaining', result.remainingPoints ?? 0);
      res.setHeader(
        'X-RateLimit-Reset',
        Math.floor(Date.now() / 1000) + Math.ceil((result.msBeforeNext ?? 0) / 1000)
      );

      next();
    } catch (err) {
      if (err instanceof RateLimiterRes) {
        // Rate limit exceeded — log for security monitoring
        console.warn(
          `[RATE_LIMIT] ${limiterName} | IP: ${ip} | Path: ${req.method} ${req.path} | ` +
          `Retry-After: ${Math.ceil(err.msBeforeNext / 1000)}s | ` +
          `Time: ${new Date().toISOString()}`
        );

        const retryAfterSeconds = Math.ceil(err.msBeforeNext / 1000);

        res.setHeader('Retry-After', retryAfterSeconds);
        res.setHeader('X-RateLimit-Limit', limiter.points);
        res.setHeader('X-RateLimit-Remaining', 0);
        res.setHeader(
          'X-RateLimit-Reset',
          Math.floor(Date.now() / 1000) + retryAfterSeconds
        );

        res.status(429).json({
          error: 'Too many requests',
          message: `Rate limit exceeded. Please retry after ${retryAfterSeconds} seconds.`,
          retryAfter: retryAfterSeconds,
        });
      } else {
        // Redis connection error — fail open so the API stays up
        console.error(`[RATE_LIMIT_ERROR] ${limiterName} Redis error:`, err);
        next();
      }
    }
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Exported middleware
// ─────────────────────────────────────────────────────────────────────────────

export const authLimiter     = createRateLimitMiddleware(authLimiterInstance,    'AUTH');
export const uploadLimiter   = createRateLimitMiddleware(uploadLimiterInstance,  'UPLOAD');
export const queryLimiter    = createRateLimitMiddleware(queryLimiterInstance,   'QUERY');
export const searchLimiter   = createRateLimitMiddleware(searchLimiterInstance,  'SEARCH');
export const generalLimiter  = createRateLimitMiddleware(generalLimiterInstance, 'GENERAL');
