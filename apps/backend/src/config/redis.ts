import Redis from 'ioredis';

if (!process.env.REDIS_URL) {
  throw new Error('REDIS_URL is not defined in environment variables');
}

export const redis = new Redis(process.env.REDIS_URL, {
  maxRetriesPerRequest: null, // required for BullMQ
  tls: {
    rejectUnauthorized: false, // required for Upstash TLS
  },
});

redis.on('connect', () => {
  console.log('Redis connected');
});

redis.on('error', (err) => {
  console.error('Redis connection error:', err.message);
});