import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv';
import { createServer } from 'http';

dotenv.config();

import { prisma } from './config/database';
import { redis } from './config/redis';

const app = express();
const httpServer = createServer(app);

// ── Middleware ────────────────────────────────────────────
app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true,
}));
app.use(morgan('dev'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ── Health check ──────────────────────────────────────────
app.get('/health', async (_req, res) => {
  try {
    // Test DB connection
    await prisma.$queryRaw`SELECT 1`;

    // Test Redis connection
    await redis.ping();

    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV,
      services: {
        database: 'connected',
        redis: 'connected',
        groq: process.env.GROQ_API_KEY ? 'key loaded' : 'missing',
        supabase: process.env.SUPABASE_URL ? 'key loaded' : 'missing',
      },
    });
  } catch (error) {
    res.status(503).json({
      status: 'error',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// ── Routes ───────────────────────────────────────────────
import authRouter from './routes/auth';
app.use('/api/auth', authRouter);

// ── 404 handler ───────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// ── Start ─────────────────────────────────────────────────
const PORT = process.env.PORT || 5001;

async function bootstrap() {
  try {
    // Test DB on startup
    await prisma.$connect();
    console.log('Database connected');

    httpServer.listen(PORT, () => {
      console.log(`
  ┌─────────────────────────────────────┐
  │   DocuMind AI Backend               │
  │   http://localhost:${PORT}             │
  │   Environment: ${process.env.NODE_ENV}          │
  └─────────────────────────────────────┘
      `);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

bootstrap();

export { app, httpServer };