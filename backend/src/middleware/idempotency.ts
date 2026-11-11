import type { Context, Next } from 'hono';
import { SyncError, SyncErrorCode } from '../errors';

interface IdempotencyRecord {
  response: unknown;
  timestamp: number;
  status: number;
}

class IdempotencyStore {
  private store = new Map<string, IdempotencyRecord>();
  private readonly TTL = 24 * 60 * 60 * 1000;
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
    if (status < 200 || status >= 300) return;

    // Only JSON can be replayed through c.json. Parsing a non-JSON success body here would throw and turn
    // the success into a 500, so skip caching it.
    try {
      const responseBody = await c.res.clone().json();
      idempotencyStore.set(storeKey, responseBody, status);
    } catch {
      // Not JSON: leave the response uncached.
    }
  };
}
