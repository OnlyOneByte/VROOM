import { createHash } from 'node:crypto';
import type { Context, Next } from 'hono';
import { UnprocessableEntityError, ValidationError } from '../errors';

const MAX_KEY_LENGTH = 255;

interface IdempotencyRecord {
  fingerprint: string;
  response: unknown;
  timestamp: number;
  status: number;
}

class IdempotencyStore {
  private store = new Map<string, IdempotencyRecord>();
  private readonly TTL = 24 * 60 * 60 * 1000;
  private readonly MAX_SIZE = 10000;

  set(key: string, fingerprint: string, response: unknown, status: number): void {
    if (this.store.size >= this.MAX_SIZE) {
      this.cleanup();
    }
    this.store.set(key, { fingerprint, response, timestamp: Date.now(), status });
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

async function requestFingerprint(c: Context): Promise<string> {
  const hash = createHash('sha256').update(`${c.req.method} ${c.req.path}\n`);
  const body = await c.req.arrayBuffer();
  const form = await multipartFields(body, c.req.header('content-type') ?? '');
  if (!form) return hash.update(new Uint8Array(body)).digest('hex');
  for (const [name, value] of form) {
    const bytes =
      typeof value === 'string'
        ? new TextEncoder().encode(value)
        : new Uint8Array(await value.arrayBuffer());
    hash.update(`${name}\0${bytes.byteLength}\0`).update(bytes);
  }
  return hash.digest('hex');
}

async function multipartFields(
  body: ArrayBuffer,
  contentType: string
): Promise<[string, string | Blob][] | null> {
  if (!contentType.startsWith('multipart/form-data')) return null;
  const form = await new Response(body, { headers: { 'content-type': contentType } })
    .formData()
    .catch(() => null);
  if (!form) return null;
  const fields: [string, string | Blob][] = [];
  form.forEach((value, name) => {
    fields.push([name, value]);
  });
  return fields;
}

function readIdempotencyKey(c: Context, required: boolean): string | null {
  const key = c.req.header('Idempotency-Key');
  if (!key) {
    if (required) throw new ValidationError('Idempotency-Key header required');
    return null;
  }
  if (key.length > MAX_KEY_LENGTH) {
    throw new ValidationError(`Idempotency-Key must be at most ${MAX_KEY_LENGTH} characters`);
  }
  return key;
}

function cachedReplay(storeKey: string, fingerprint: string): IdempotencyRecord | undefined {
  const cached = idempotencyStore.get(storeKey);
  if (cached && cached.fingerprint !== fingerprint) {
    throw new UnprocessableEntityError(
      'This Idempotency-Key was already used for a different request'
    );
  }
  return cached;
}

export function idempotency(options: { required?: boolean } = {}) {
  return async (c: Context, next: Next) => {
    if (!['POST', 'PUT', 'DELETE', 'PATCH'].includes(c.req.method)) {
      return next();
    }

    const idempotencyKey = readIdempotencyKey(c, options.required ?? false);
    if (!idempotencyKey) return next();

    const userId = c.get('user')?.id || 'anonymous';
    const storeKey = `${userId}:${idempotencyKey}`;
    const fingerprint = await requestFingerprint(c);

    const cached = cachedReplay(storeKey, fingerprint);
    if (cached) {
      return c.json(cached.response, cached.status as never);
    }

    await next();

    const status = c.res.status;
    if (status < 200 || status >= 300) return;

    try {
      const responseBody = await c.res.clone().json();
      idempotencyStore.set(storeKey, fingerprint, responseBody, status);
    } catch {
      // Not JSON: leave the response uncached.
    }
  };
}
