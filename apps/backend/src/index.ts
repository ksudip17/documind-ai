import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv';
import { createServer } from 'http';

dotenv.config();

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
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV,
  });
});

// ── Routes (we'll add these phase by phase) ───────────────
// app.use('/api/auth', authRouter);
// app.use('/api/documents', documentRouter);
// app.use('/api/query', queryRouter);
// app.use('/api/admin', adminRouter);

// ── 404 handler ───────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// ── Start ─────────────────────────────────────────────────
const PORT = process.env.PORT || 5000;
httpServer.listen(PORT, () => {
  console.log(`
  ┌─────────────────────────────────────┐
  │   DocuMind AI Backend               │
  │   Running on http://localhost:${PORT}  │
  │   Environment: ${process.env.NODE_ENV}          │
  └─────────────────────────────────────┘
  `);
});

export { app, httpServer };