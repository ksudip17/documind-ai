/**
 * src/config/env.ts
 *
 * Environment variable loader and startup validator.
 *
 * WHY VALIDATE ON STARTUP:
 *  A missing DATABASE_URL or JWT_SECRET will cause cryptic runtime errors
 *  long after the server starts. By throwing immediately at boot, we fail
 *  fast and surface the problem in deployment logs before any request is served.
 *
 * HOW TO USE:
 *  Import this file FIRST in src/index.ts (already done via `import './config/env'`).
 *  Then use the typed `env` object instead of raw process.env access.
 *
 *  import { env } from '../config/env';
 *  const secret = env.JWT_SECRET;  // ← typed, guaranteed non-empty
 */

import dotenv from 'dotenv';
dotenv.config();

// ─────────────────────────────────────────────────────────────────────────────
// Required variables — server will refuse to start if any are missing or empty
// ─────────────────────────────────────────────────────────────────────────────

const REQUIRED_VARS = [
  'NODE_ENV',
  'PORT',
  'JWT_SECRET',
  'JWT_EXPIRES_IN',
  'DATABASE_URL',
  'REDIS_URL',
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_KEY',
  'SUPABASE_STORAGE_BUCKET',
  'GROQ_API_KEY',
  'FRONTEND_URL',
] as const;

// Validate on module load (synchronous, before anything else runs)
const missing: string[] = [];

for (const key of REQUIRED_VARS) {
  const value = process.env[key];
  if (!value || value.trim() === '') {
    missing.push(key);
  }
}

if (missing.length > 0) {
  console.error('❌ Missing required environment variables:');
  missing.forEach((key) => console.error(`   - ${key}`));
  console.error('\nCopy .env.example to .env and fill in all values.');
  process.exit(1);
}

// ─────────────────────────────────────────────────────────────────────────────
// Typed env object
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Exported typed env object.
 * All values are guaranteed non-empty strings (validated above).
 * Use this instead of process.env throughout the codebase.
 */
export const env = {
  NODE_ENV:                 process.env.NODE_ENV as 'development' | 'production' | 'test',
  PORT:                     Number(process.env.PORT) || 5001,
  JWT_SECRET:               process.env.JWT_SECRET!,
  JWT_EXPIRES_IN:           process.env.JWT_EXPIRES_IN!,
  DATABASE_URL:             process.env.DATABASE_URL!,
  REDIS_URL:                process.env.REDIS_URL!,
  SUPABASE_URL:             process.env.SUPABASE_URL!,
  SUPABASE_ANON_KEY:        process.env.SUPABASE_ANON_KEY!,
  SUPABASE_SERVICE_KEY:     process.env.SUPABASE_SERVICE_KEY!,
  SUPABASE_STORAGE_BUCKET:  process.env.SUPABASE_STORAGE_BUCKET!,
  GROQ_API_KEY:             process.env.GROQ_API_KEY!,
  FRONTEND_URL:             process.env.FRONTEND_URL!,
  // Optional vars with safe defaults
  UPSTASH_REDIS_REST_URL:   process.env.UPSTASH_REDIS_REST_URL ?? '',
  UPSTASH_REDIS_REST_TOKEN: process.env.UPSTASH_REDIS_REST_TOKEN ?? '',

  get isProduction() { return this.NODE_ENV === 'production'; },
  get isDevelopment() { return this.NODE_ENV === 'development'; },
} as const;

