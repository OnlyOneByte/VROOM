/**
 * Idempotency Middleware
 *
 * Prevents duplicate operations by caching responses for idempotency keys.
 * Useful for preventing double-charges, duplicate records, etc.
 */

import type { Context, Next } from 'hono';
import { SyncError, SyncErrorCode } from '../errors';

interface IdempotencyRecord {
  response: unknown;
  timestamp: number;
  status: number;
}

class IdempotencyStore {
  private store = new Map<string, IdempotencyRecord>();
  private readonly TTL = 24 * 60 * 60 * 1000; // 24 hours

  set(key: string, response: unknown, status: number): void {
    this.store.set(key, { response, timestamp: Date.now(), status });
    this.cleanup();
  }

  get(key: string): IdempotencyRecord | undefined {
    const record = this.store.get(key);
    if (!record || Date.now() - record.timestamp > this.TTL) {
      this.store.delete(key);
      return undefined;
    }
    return record;
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, record] of this.store.entries()) {
      if (now - record.timestamp > this.TTL) this.store.delete(key);
    }
  }
}

const idempotencyStore = new IdempotencyStore();

/**
 * Idempotency middleware
 * Caches successful responses and returns them for duplicate requests
 *
 * @param options.required - If true, requires Idempotency-Key header
 */
export function idempotency(options: { required?: boolean } = {}) {
  return async (c: Context, next: Next) => {
    if (!['POST', 'PUT', 'DELETE', 'PATCH'].includes(c.req.method)) {
      return next();
    }

    const idempotencyKey = c.req.header('Idempotency-Key');
    if (!idempotencyKey) {
      if (options.required) {
        throw new SyncError(SyncErrorCode.VALIDATION_ERROR, 'Idempotency-Key header required');
      }
      return next();
    }

    const userId = c.get('user')?.id || 'anonymous';
    const storeKey = `${userId}:${idempotencyKey}`;

    const cached = idempotencyStore.get(storeKey);
    if (cached) {
      return c.json(cached.response, cached.status as never);
    }

    await next();

    const response = c.res.clone();
    const responseBody = await response.json();
    const status = response.status;

    if (status >= 200 && status < 300) {
      idempotencyStore.set(storeKey, responseBody, status);
    }
  };
}
