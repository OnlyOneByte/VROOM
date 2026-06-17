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
  private readonly MAX_SIZE = 10000;

  set(key: string, response: unknown, status: number): void {
    if (this.store.size >= this.MAX_SIZE) {
      this.cleanup();
    }
    this.store.set(key, { response, timestamp: Date.now(), status });
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

    const status = c.res.status;
    if (status < 200 || status >= 300) return; // only cache 2xx (a transient 5xx must not replay forever)

    // Cache the response body for replay — but ONLY if it's JSON we can re-emit via c.json on a hit.
    // A non-JSON 2xx (e.g. a CSV/binary/204 body) can't round-trip through the cached-replay `c.json`,
    // and `response.json()` would THROW on it — turning a SUCCESSFUL response into a 500. No
    // idempotency-wrapped route returns non-JSON today, but guard it so adding one can't regress: parse
    // defensively + skip caching (not cached → the dup just re-runs the handler, the safe degradation).
    try {
      const responseBody = await c.res.clone().json();
      idempotencyStore.set(storeKey, responseBody, status);
    } catch {
      // Non-JSON 2xx body — not idempotency-cacheable; leave it uncached.
    }
  };
}
