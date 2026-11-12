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

function ensureCleanupTimer(): void {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of rateLimitStore.entries()) {
      if (entry.resetTime < now) rateLimitStore.delete(key);
    }
  }, CONFIG.rateLimit.cleanupInterval);
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
      rateLimitStore.set(key, { count: 1, resetTime: now + config.windowMs });
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
