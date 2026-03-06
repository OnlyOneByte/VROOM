/**
 * Rate Limiting Middleware
 *
 * Protects against abuse by limiting request frequency per user/IP.
 *
 * IMPORTANT: Uses in-memory storage. For production with multiple instances,
 * consider using Redis or a distributed cache.
 */

import type { Context, Next } from 'hono';
import { CONFIG } from '../config';
import { createErrorResponse } from '../errors';

export interface RateLimitConfig {
  windowMs: number;
  limit: number;
  keyGenerator: (c: Context) => string;
  message?: string;
}

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

const rateLimitStore = new Map<string, RateLimitEntry>();

// Cleanup expired entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimitStore.entries()) {
    if (entry.resetTime < now) rateLimitStore.delete(key);
  }
}, CONFIG.rateLimit.cleanupInterval);

/**
 * Rate limiter middleware factory
 * Creates a rate limiter with specified configuration
 */
export function rateLimiter(config: RateLimitConfig) {
  return async (c: Context, next: Next) => {
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
