import { redis } from '../config/redis';
import crypto from 'crypto';

const CACHE_TTL = 3600; // 1 hour

function getCacheKey(question: string, documentId: string): string {
  const hash = crypto
    .createHash('sha256')
    .update(`${documentId}:${question.toLowerCase().trim()}`)
    .digest('hex')
    .slice(0, 16);
  return `query:${hash}`;
}

export async function getCachedAnswer(
  question: string,
  documentId: string
): Promise<any | null> {
  try {
    const key = getCacheKey(question, documentId);
    const cached = await redis.get(key);
    return cached ? JSON.parse(cached) : null;
  } catch {
    return null;
  }
}

export async function setCachedAnswer(
  question: string,
  documentId: string,
  result: any
): Promise<void> {
  try {
    const key = getCacheKey(question, documentId);
    await redis.setex(key, CACHE_TTL, JSON.stringify(result));
  } catch {
    // Cache failure is non-fatal
  }
}
