/**
 * Idempotency middleware for critical operations
 * Prevents duplicate operations from being executed
 */

import type { Context, Next } from 'hono';
import { SyncError, SyncErrorCode } from '../core/errors/';
import { logger } from '../utils/logger';

interface IdempotencyRecord {
  response: unknown;
  timestamp: number;
  status: number;
}

/**
 * In-memory idempotency store
 *
 * ⚠️ PRODUCTION WARNING:
 * This is an in-memory implementation that will NOT work correctly in:
 * - Multi-instance deployments (each instance has its own cache)
 * - Serverless environments (cache is lost between invocations)
 * - Load-balanced setups (requests may hit different instances)
 *
 * For production, replace with:
 * - Redis (recommended): Fast, distributed, with TTL support
 * - Database table: Persistent but slower
 * - Memcached: Fast but no persistence
 */
class IdempotencyStore {
  private store = new Map<string, IdempotencyRecord>();
  private readonly TTL = 24 * 60 * 60 * 1000; // 24 hours

  set(key: string, response: unknown, status: number): void {
    this.store.set(key, {
      response,
      timestamp: Date.now(),
      status,
    });

    // Clean up old entries
    this.cleanup();
  }

  get(key: string): IdempotencyRecord | undefined {
    const record = this.store.get(key);

    if (!record) {
      return undefined;
    }

    // Check if expired
    if (Date.now() - record.timestamp > this.TTL) {
      this.store.delete(key);
      return undefined;
    }

    return record;
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, record] of this.store.entries()) {
      if (now - record.timestamp > this.TTL) {
        this.store.delete(key);
      }
    }
  }

  clear(): void {
    this.store.clear();
  }
}

const idempotencyStore = new IdempotencyStore();

/**
 * Idempotency middleware
 * Requires an Idempotency-Key header for POST/PUT/DELETE requests
 */
export function idempotencyMiddleware(options: { required?: boolean } = {}) {
  return async (c: Context, next: Next) => {
    const method = c.req.method;

    // Only apply to mutating operations
    if (!['POST', 'PUT', 'DELETE', 'PATCH'].includes(method)) {
      return next();
    }

    const idempotencyKey = c.req.header('Idempotency-Key');

    // If idempotency key is not provided
    if (!idempotencyKey) {
      if (options.required) {
        throw new SyncError(
          SyncErrorCode.VALIDATION_ERROR,
          'Idempotency-Key header is required for this operation'
        );
      }
      // If not required, proceed without idempotency
      return next();
    }

    const userId = c.get('user')?.id || 'anonymous';
    const storeKey = `${userId}:${idempotencyKey}`;

    // Check if we've seen this key before
    const cached = idempotencyStore.get(storeKey);
    if (cached) {
      logger.info('Idempotent request detected, returning cached response', {
        userId,
        idempotencyKey,
        age: Date.now() - cached.timestamp,
      });

      return c.json(cached.response, cached.status as never);
    }

    // Execute the request
    await next();

    // Cache the response
    const response = c.res.clone();
    const responseBody = await response.json();
    const status = response.status;

    // Only cache successful responses (2xx)
    if (status >= 200 && status < 300) {
      idempotencyStore.set(storeKey, responseBody, status);

      logger.info('Cached idempotent response', {
        userId,
        idempotencyKey,
        status,
      });
    }
  };
}

/**
 * Clear idempotency cache (useful for testing)
 */
export function clearIdempotencyCache(): void {
  idempotencyStore.clear();
}
