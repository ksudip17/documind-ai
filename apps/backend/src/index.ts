/**
 * src/index.ts
 *
 * DocuMind AI — Express application entry point.
 *
 * SECURITY MIDDLEWARE ORDER (matters!):
 *  1. Trust proxy         — must be first so req.ip is accurate behind Nginx
 *  2. Helmet              — sets all security response headers
 *  3. CORS                — must come before routes, after helmet
 *  4. Request ID          — attach tracing ID before any logging
 *  5. Body parsers        — parse before sanitisation
 *  6. sanitizeBody        — clean input before it reaches validation/routes
 *  7. Morgan logger       — log after body is parsed for context
 *  8. generalLimiter      — last global guard before routes
 *  9. Routes              — each route adds its own specific limiter + validate()
 * 10. 404 handler
 * 11. errorHandler        — MUST be last; catches everything forwarded via next(err)
 */

import './config/env';                          // ← validates all env vars on startup
import express, { Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import crypto from 'crypto';
import { createServer } from 'http';
import { startDocumentWorker } from './workers/documentWorker';
import authRouter from './routes/auth';
import documentRouter from './routes/document';
import queryRouter from './routes/query';
import adminRouter from './routes/admin';
import { errorHandler } from './middleware/errorHandler';
import { generalLimiter } from './middleware/rateLimiter';
import { sanitizeBody } from './middleware/sanitize';
import { prisma } from './config/database';
import { redis } from './config/redis';
import { env } from './config/env';

const app = express();

// ── 1. Trust proxy (Nginx on EC2) ────────────────────────────────────────────
// Required so that req.ip and x-forwarded-for are correct.
// '1' means trust the first proxy hop (our Nginx).
app.set('trust proxy', 1);

// ── 2. Helmet — security headers ─────────────────────────────────────────────
//
// WHY EACH HEADER:
//  HSTS:             Forces browsers to use HTTPS for 1 year; includes subdomains.
//                    'preload' opts into browser preload lists.
//  frameguard:       X-Frame-Options: DENY — prevents clickjacking via <iframe>.
//  noSniff:          X-Content-Type-Options: nosniff — prevents MIME sniffing
//                    which could cause browsers to execute non-JS files as JS.
//  referrerPolicy:   Only send origin (no path) in Referer header when crossing
//                    origins, preventing credential leakage in query strings.
//  permissionsPolicy: Disables browser APIs that DocuMind doesn't use.
//  contentSecurityPolicy: Whitelist of exactly where resources can load from.
//                    frame-ancestors 'none' is the CSP equivalent of X-Frame-Options.

app.use(
  helmet({
    // ── HSTS ───────────────────────────────────────────────────────────────
    hsts: {
      maxAge: 31536000,          // 1 year in seconds (required for preload)
      includeSubDomains: true,
      preload: true,
    },

    // ── X-Frame-Options: DENY ──────────────────────────────────────────────
    frameguard: { action: 'deny' },

    // ── X-Content-Type-Options: nosniff ───────────────────────────────────
    noSniff: true,

    // ── Referrer-Policy ───────────────────────────────────────────────────
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },

    // ── Content-Security-Policy ───────────────────────────────────────────
    contentSecurityPolicy: {
      directives: {
        // Default: only allow resources from our own origin
        defaultSrc: ["'self'"],

        // Scripts: only from self + Next.js on Vercel
        scriptSrc: ["'self'"],

        // Styles: self + Tailwind inline styles require unsafe-inline here
        // (Tailwind does not use nonces). Lock down further if you add a CDN.
        styleSrc: ["'self'", "'unsafe-inline'"],

        // Images: self + data URIs (base64 previews) + HTTPS (Supabase Storage CDN)
        imgSrc: ["'self'", "data:", "https:"],

        // Fonts: self only
        fontSrc: ["'self'"],

        // API connections: self + Supabase + Groq (for client-side calls if any)
        connectSrc: [
          "'self'",
          env.FRONTEND_URL,
          env.SUPABASE_URL,
          "https://api.groq.com",
        ],

        // No plugins/objects (Flash, Java applets, etc.)
        objectSrc: ["'none'"],

        // Base URI locked to self (prevents base-tag injection)
        baseUri: ["'self'"],

        // Prevents this page from being embedded in any frame (clickjacking)
        frameAncestors: ["'none'"],

        // Forms only submit to our own origin
        formAction: ["'self'"],

        // Upgrade insecure requests to HTTPS in production
        ...(env.isProduction ? { upgradeInsecureRequests: [] } : {}),
      },
    },

    // ── Permissions-Policy ────────────────────────────────────────────────
    // Disables browser APIs DocuMind AI does not use.
    // Prevents malicious scripts from silently accessing camera/mic/GPS.
    permittedCrossDomainPolicies: false,
    crossOriginEmbedderPolicy: false,  // set to true only if you need SharedArrayBuffer
  })
);

// Permissions-Policy is not yet in Helmet's built-in set; add manually
app.use((_req, res, next) => {
  res.setHeader(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), payment=()'
  );
  next();
});

// ── 3. CORS ───────────────────────────────────────────────────────────────────
//
// Explicitly whitelist our frontend origin. Never use '*' in production —
// it allows any website to make authenticated requests from a user's browser.

const ALLOWED_ORIGINS = [
  env.FRONTEND_URL,
  // Allow localhost variants during development
  ...(env.isDevelopment
    ? ['http://localhost:3000', 'http://127.0.0.1:3000']
    : []),
];

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow server-to-server requests (no origin header) and whitelisted origins
      if (!origin || ALLOWED_ORIGINS.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error(`CORS: origin '${origin}' is not allowed`));
      }
    },
    credentials: true,                  // allow Authorization header / cookies
    methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID'],
    exposedHeaders: ['X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset', 'Retry-After'],
  })
);

// ── 4. Request ID — tracing header ───────────────────────────────────────────
// Attaches a unique ID to every request so logs can be correlated across
// services. The client can also send X-Request-ID and we echo it back.
const httpServer = createServer(app);

app.use((req, res, next) => {
  const requestId = (req.headers['x-request-id'] as string) || crypto.randomUUID();
  res.setHeader('X-Request-ID', requestId);
  (req as Request & { requestId: string }).requestId = requestId;
  next();
});

// ── 5. Body parsers ───────────────────────────────────────────────────────────
// Limit JSON body to 10MB to prevent DoS via oversized payloads.
// (File uploads go through multer separately; JSON routes are typically small.)
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ── 6. Input sanitisation ─────────────────────────────────────────────────────
// Trims strings, normalises emails, strips __proto__ pollution keys.
// Runs BEFORE routes so every request body is clean before Zod sees it.
app.use(sanitizeBody);

// ── 7. HTTP request logger ────────────────────────────────────────────────────
// Use 'combined' in production (Apache log format, compatible with log aggregators)
// Use 'dev' in development (colourised, concise)
app.use(morgan(env.isProduction ? 'combined' : 'dev'));

// ── 8. Global rate limiter ────────────────────────────────────────────────────
// Applies 1000 req/hour per IP to ALL routes as a last-resort DoS backstop.
// Specific routes apply tighter limiters on top of this.
app.use(generalLimiter);

// ── Root ──────────────────────────────────────────────────────────────────────
app.get('/', (_req, res) => {
  res.json({
    status: 'ok',
    message: 'DocuMind AI Backend is Running',
  });
});

// ── Health check ──────────────────────────────────────────────────────────────
// Intentionally does NOT apply auth — used by load balancer and monitoring.
// Does NOT expose sensitive service details in production.
app.get('/health', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    await redis.ping();

    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      environment: env.NODE_ENV,
      // In production, only expose status booleans — not key presence
      services: env.isProduction
        ? { database: 'connected', redis: 'connected' }
        : {
            database: 'connected',
            redis:    'connected',
            groq:     env.GROQ_API_KEY    ? 'key loaded' : 'missing',
            supabase: env.SUPABASE_URL    ? 'key loaded' : 'missing',
          },
    });
  } catch (error) {
    // Only log internally — don't expose error details to external callers
    console.error('[HEALTH_CHECK_FAILED]', error);
    res.status(503).json({ status: 'error', message: 'Service unavailable' });
  }
});

// ── 9. Routes ─────────────────────────────────────────────────────────────────
app.use('/api/auth',      authRouter);
app.use('/api/documents', documentRouter);
app.use('/api/query',     queryRouter);
app.use('/api/admin',     adminRouter);

// ── 10. 404 handler ───────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// ── 11. Global error handler ──────────────────────────────────────────────────
// MUST be last — Express identifies error-handling middleware by its 4-arg signature
app.use(errorHandler);

// ── Start ─────────────────────────────────────────────────────────────────────
async function bootstrap() {
  try {
    await prisma.$connect();
    console.log('✅ Database connected');
    startDocumentWorker();

    httpServer.listen(env.PORT, () => {
      console.log(`
  ┌─────────────────────────────────────┐
  │   DocuMind AI Backend               │
  │   http://localhost:${env.PORT}             │
  │   Environment: ${env.NODE_ENV}          │
  └─────────────────────────────────────┘
      `);
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

bootstrap();

export { app, httpServer };