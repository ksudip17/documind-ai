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

import './config/env';
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

// ── 1. Trust proxy ────────────────────────────────────────────────────────────
app.set('trust proxy', 1);

// ── 2. Helmet ─────────────────────────────────────────────────────────────────
app.use(
  helmet({
    hsts: {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true,
    },
    frameguard: { action: 'deny' },
    noSniff: true,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "https:"],
        fontSrc: ["'self'"],
        connectSrc: [
          "'self'",
          "https://documind-ai.mooo.com",
          "https://api.groq.com",
          "wss:",
        ],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        frameAncestors: ["'none'"],
        formAction: ["'self'"],
        ...(env.isProduction ? { upgradeInsecureRequests: [] } : {}),
      },
    },
    permittedCrossDomainPolicies: false,
    crossOriginEmbedderPolicy: false,
  })
);

// Permissions-Policy header
app.use((_req, res, next) => {
  res.setHeader(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), payment=()'
  );
  next();
});

// ── 3. CORS ───────────────────────────────────────────────────────────────────
const ALLOWED_ORIGINS = [
  env.FRONTEND_URL,
  ...(env.isDevelopment
    ? ['http://localhost:3000', 'http://127.0.0.1:3000']
    : []),
];

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || ALLOWED_ORIGINS.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error(`CORS: origin '${origin}' is not allowed`));
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID'],
    exposedHeaders: [
      'X-RateLimit-Limit',
      'X-RateLimit-Remaining',
      'X-RateLimit-Reset',
      'Retry-After',
    ],
  })
);

// ── 4. Request ID ─────────────────────────────────────────────────────────────
const httpServer = createServer(app);

app.use((req, res, next) => {
  const requestId =
    (req.headers['x-request-id'] as string) || crypto.randomUUID();
  res.setHeader('X-Request-ID', requestId);
  (req as Request & { requestId: string }).requestId = requestId;
  next();
});

// ── 5. Body parsers ───────────────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ── 6. Input sanitisation ─────────────────────────────────────────────────────
app.use(sanitizeBody);

// ── 7. HTTP request logger ────────────────────────────────────────────────────
app.use(morgan(env.isProduction ? 'combined' : 'dev'));

// ── 8. Global rate limiter ────────────────────────────────────────────────────
app.use(generalLimiter);

// ── Root ──────────────────────────────────────────────────────────────────────
app.get('/', (_req, res) => {
  res.json({
    status: 'ok',
    message: 'DocuMind AI Backend is Running',
  });
});

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/health', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    await redis.ping();

    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      environment: env.NODE_ENV,
      services: env.isProduction
        ? { database: 'connected', redis: 'connected' }
        : {
          database: 'connected',
          redis: 'connected',
          groq: env.GROQ_API_KEY ? 'key loaded' : 'missing',
          supabase: env.SUPABASE_URL ? 'key loaded' : 'missing',
        },
    });
  } catch (error) {
    console.error('[HEALTH_CHECK_FAILED]', error);
    res.status(503).json({ status: 'error', message: 'Service unavailable' });
  }
});

// ── 9. Routes ─────────────────────────────────────────────────────────────────
app.use('/api/auth', authRouter);
app.use('/api/documents', documentRouter);
app.use('/api/query', queryRouter);
app.use('/api/admin', adminRouter);

// ── 10. 404 handler ───────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// ── 11. Global error handler ──────────────────────────────────────────────────
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