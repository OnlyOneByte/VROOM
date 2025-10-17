import type { Context, MiddlewareHandler } from 'hono';
import { config } from '../config';
import { RateLimitError } from '../errors';

interface RateLimitEntry {
  count: number;
  resetTime: number;
  firstRequest: number;
}

/**
 * Simple in-memory rate limiter with cleanup
 *
 * ⚠️ PRODUCTION WARNING:
 * This in-memory implementation will NOT work correctly in multi-instance deployments.
 * Each instance maintains its own rate limit counters, so the actual rate limit
 * will be multiplied by the number of instances.
 *
 * For production deployments with multiple instances, use Redis-based rate limiting:
 * - @upstash/ratelimit
 * - ioredis with custom implementation
 * - rate-limiter-flexible with Redis adapter
 */
class RateLimiter {
  private requests = new Map<string, RateLimitEntry>();
  private cleanupInterval: Timer | null = null;

  constructor() {
    // Clean up expired entries every 5 minutes
    this.cleanupInterval = setInterval(
      () => {
        this.cleanup();
      },
      5 * 60 * 1000
    );
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, value] of this.requests.entries()) {
      if (now > value.resetTime) {
        this.requests.delete(key);
      }
    }
  }

  private getClientId(c: Context): string {
    // Try to get real IP from various headers
    const forwarded = c.req.header('x-forwarded-for');
    const realIp = c.req.header('x-real-ip');
    const cfConnectingIp = c.req.header('cf-connecting-ip');

    if (forwarded) {
      // x-forwarded-for can contain multiple IPs, take the first one
      return forwarded.split(',')[0].trim();
    }

    return cfConnectingIp || realIp || 'unknown';
  }

  public checkLimit(c: Context): { allowed: boolean; headers: Record<string, string> } {
    const clientId = this.getClientId(c);
    const now = Date.now();
    const windowMs = config.rateLimit.windowMs;
    const maxRequests = config.rateLimit.max;

    const current = this.requests.get(clientId);

    if (!current) {
      // First request from this client
      this.requests.set(clientId, {
        count: 1,
        resetTime: now + windowMs,
        firstRequest: now,
      });

      return {
        allowed: true,
        headers: {
          'X-RateLimit-Limit': maxRequests.toString(),
          'X-RateLimit-Remaining': (maxRequests - 1).toString(),
          'X-RateLimit-Reset': Math.ceil(windowMs / 1000).toString(),
        },
      };
    }

    if (now > current.resetTime) {
      // Window has expired, reset
      this.requests.set(clientId, {
        count: 1,
        resetTime: now + windowMs,
        firstRequest: now,
      });

      return {
        allowed: true,
        headers: {
          'X-RateLimit-Limit': maxRequests.toString(),
          'X-RateLimit-Remaining': (maxRequests - 1).toString(),
          'X-RateLimit-Reset': Math.ceil(windowMs / 1000).toString(),
        },
      };
    }

    // Within window, increment count
    current.count++;
    const remaining = Math.max(0, maxRequests - current.count);
    const resetTime = Math.ceil((current.resetTime - now) / 1000);

    const headers = {
      'X-RateLimit-Limit': maxRequests.toString(),
      'X-RateLimit-Remaining': remaining.toString(),
      'X-RateLimit-Reset': resetTime.toString(),
    };

    if (current.count > maxRequests) {
      return {
        allowed: false,
        headers,
      };
    }

    return {
      allowed: true,
      headers,
    };
  }

  public destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.requests.clear();
  }
}

// Global rate limiter instance
const rateLimiterInstance = new RateLimiter();

// Graceful shutdown cleanup
process.on('SIGTERM', () => {
  rateLimiterInstance.destroy();
});

process.on('SIGINT', () => {
  rateLimiterInstance.destroy();
});

export const rateLimiter: MiddlewareHandler = async (c, next) => {
  // Skip rate limiting in test environment
  if (config.env === 'test') {
    return next();
  }

  const { allowed, headers } = rateLimiterInstance.checkLimit(c);

  // Set rate limit headers
  for (const [key, value] of Object.entries(headers)) {
    c.header(key, value);
  }

  if (!allowed) {
    const resetTime = parseInt(headers['X-RateLimit-Reset'], 10);
    throw new RateLimitError(`Too many requests. Try again in ${resetTime} seconds.`);
  }

  return next();
};
