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

function startWindow(key: string, now: number, windowMs: number): void {
  rateLimitStore.delete(key);
  while (rateLimitStore.size >= CONFIG.rateLimit.maxTrackedKeys) {
    const oldest = rateLimitStore.keys().next().value;
    if (oldest === undefined) break;
    rateLimitStore.delete(oldest);
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
