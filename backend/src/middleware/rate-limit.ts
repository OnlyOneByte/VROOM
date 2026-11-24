import type { Context, Next } from 'hono';
import { CONFIG } from '../config';
import { createErrorResponse } from '../errors';

interface RateLimitConfig {
  windowMs: number;
  limit: number;
  keyGenerator: (c: Context) => string;
  message?: string;
}

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

// In-memory and per process: with several instances, each one enforces its own limit.
const rateLimitStore = new Map<string, RateLimitEntry>();

let cleanupTimer: ReturnType<typeof setInterval> | null = null;

function dropExpired(now: number): void {
  for (const [key, entry] of rateLimitStore.entries()) {
    if (entry.resetTime < now) rateLimitStore.delete(key);
  }
}

let evictionCursor: Iterator<string> | null = null;

function evictOldest(): boolean {
  for (let attempt = 0; attempt < 2; attempt++) {
    evictionCursor ??= rateLimitStore.keys();
    const next = evictionCursor.next();
    if (!next.done) {
      rateLimitStore.delete(next.value);
      return true;
    }
    evictionCursor = null;
  }
  return false;
}

function startWindow(key: string, now: number, windowMs: number): void {
  rateLimitStore.delete(key);
  while (rateLimitStore.size >= CONFIG.rateLimit.maxTrackedKeys) {
    if (!evictOldest()) break;
  }
  rateLimitStore.set(key, { count: 1, resetTime: now + windowMs });
}

export function trackedRateLimitKeys(): number {
  return rateLimitStore.size;
}

function ensureCleanupTimer(): void {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => dropExpired(Date.now()), CONFIG.rateLimit.cleanupInterval);
  if (cleanupTimer && typeof cleanupTimer === 'object' && 'unref' in cleanupTimer) {
    cleanupTimer.unref();
  }
}

export function rateLimiter(config: RateLimitConfig) {
  ensureCleanupTimer();
  return async (c: Context, next: Next) => {
    if (CONFIG.disableRateLimit) return next();

    const key = config.keyGenerator(c);
    const now = Date.now();
    const entry = rateLimitStore.get(key);

    if (!entry || entry.resetTime < now) {
      startWindow(key, now, config.windowMs);
      return next();
    }

    if (entry.count >= config.limit) {
      const retryAfter = Math.ceil((entry.resetTime - now) / 1000);
      return c.json(
        createErrorResponse('RATE_LIMIT_EXCEEDED', config.message || 'Too many requests', {
          retryAfter,
        }),
        429,
        {
          'Retry-After': retryAfter.toString(),
          'X-RateLimit-Limit': config.limit.toString(),
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': entry.resetTime.toString(),
        }
      );
    }

    entry.count++;
    return next();
  };
}

interface ConcurrencyLimitConfig {
  limit: number;
  keyGenerator: (c: Context) => string;
  message: string;
  status: 429 | 503;
}

const BUSY_RETRY_AFTER_SECONDS = 5;

export function concurrencyLimiter(config: ConcurrencyLimitConfig) {
  const inFlight = new Map<string, number>();
  const code = config.status === 503 ? 'SERVER_BUSY' : 'RATE_LIMIT_EXCEEDED';
  return async (c: Context, next: Next) => {
    if (CONFIG.disableRateLimit) return next();
    const key = config.keyGenerator(c);
    const running = inFlight.get(key) ?? 0;
    if (running >= config.limit) {
      return c.json(
        createErrorResponse(code, config.message, { retryAfter: BUSY_RETRY_AFTER_SECONDS }),
        config.status,
        { 'Retry-After': String(BUSY_RETRY_AFTER_SECONDS) }
      );
    }
    inFlight.set(key, running + 1);
    try {
      await next();
    } finally {
      const left = (inFlight.get(key) ?? 1) - 1;
      if (left > 0) inFlight.set(key, left);
      else inFlight.delete(key);
    }
  };
}

const heavyJobsPerUser = concurrencyLimiter({
  limit: 1,
  keyGenerator: (c) => `heavy-jobs:${c.get('user').id}`,
  message: 'Wait for your other import or restore to finish',
  status: 429,
});

const heavyJobsOnServer = concurrencyLimiter({
  limit: CONFIG.rateLimit.heavyJobsAtOnce,
  keyGenerator: () => 'heavy-jobs',
  message: 'The server is busy with other imports and restores. Try again in a moment.',
  status: 503,
});

export const heavyJobLimiter = (c: Context, next: Next) =>
  heavyJobsPerUser(c, async () => {
    const refused = await heavyJobsOnServer(c, next);
    if (refused) c.res = refused;
  });
