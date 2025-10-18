/**
 * Simple in-memory rate limiter middleware for Hono
 */

import type { Context, Next } from 'hono';
import { createErrorResponse } from '../utils/error-response';

interface RateLimitConfig {
  windowMs: number; // Time window in milliseconds
  limit: number; // Max requests per window
  keyGenerator: (c: Context) => string; // Function to generate rate limit key
  message?: string;
}

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

const rateLimitStore = new Map<string, RateLimitEntry>();

/**
 * Clean up expired entries periodically
 */
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimitStore.entries()) {
    if (entry.resetTime < now) {
      rateLimitStore.delete(key);
    }
  }
}, 60000); // Clean up every minute

/**
 * Create a rate limiter middleware
 */
export function rateLimiter(config: RateLimitConfig) {
  return async (c: Context, next: Next) => {
    const key = config.keyGenerator(c);
    const now = Date.now();

    let entry = rateLimitStore.get(key);

    if (!entry || entry.resetTime < now) {
      // Create new entry or reset expired entry
      entry = {
        count: 1,
        resetTime: now + config.windowMs,
      };
      rateLimitStore.set(key, entry);
      return next();
    }

    if (entry.count >= config.limit) {
      const retryAfter = Math.ceil((entry.resetTime - now) / 1000);
      return c.json(
        createErrorResponse(
          'RATE_LIMIT_EXCEEDED',
          config.message || 'Too many requests. Please try again later.',
          { retryAfter }
        ),
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
    rateLimitStore.set(key, entry);

    return next();
  };
}
