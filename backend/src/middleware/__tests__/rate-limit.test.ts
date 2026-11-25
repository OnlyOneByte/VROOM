import { describe, expect, setSystemTime, test } from 'bun:test';
import { type Context, Hono } from 'hono';
import { CONFIG } from '../../config';
import { concurrencyLimiter, rateLimiter, trackedRateLimitKeys } from '../rate-limit';

interface RateLimitErrorBody {
  success: boolean;
  error: { code: string; message: string; details?: { retryAfter?: number } };
}

function makeApp(opts: { windowMs: number; limit: number; key: string }) {
  const app = new Hono();
  app.use(
    '*',
    rateLimiter({
      windowMs: opts.windowMs,
      limit: opts.limit,
      keyGenerator: () => opts.key,
    })
  );
  app.get('/ping', (c: Context) => c.json({ ok: true }));
  return app;
}

test('precondition: rate limiting is ACTIVE in the test process (not the E2E opt-out)', () => {
  expect(CONFIG.disableRateLimit).toBe(false);
});

describe('rate-limit middleware — window + limit', () => {
  test('requests up to the limit pass; the one over returns 429 with the documented headers', async () => {
    const app = makeApp({ windowMs: 60_000, limit: 3, key: 'k-limit' });
    for (let i = 0; i < 3; i++) {
      const res = await app.request('/ping');
      expect(res.status).toBe(200);
    }
    const blocked = await app.request('/ping');
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('X-RateLimit-Limit')).toBe('3');
    expect(blocked.headers.get('X-RateLimit-Remaining')).toBe('0');
    expect(blocked.headers.get('Retry-After')).toBeTruthy();
    expect(blocked.headers.get('X-RateLimit-Reset')).toBeTruthy();
  });

  test('a 429 body carries RATE_LIMIT_EXCEEDED + a retryAfter detail', async () => {
    const app = makeApp({ windowMs: 60_000, limit: 1, key: 'k-body' });
    expect((await app.request('/ping')).status).toBe(200);
    const blocked = await app.request('/ping');
    expect(blocked.status).toBe(429);
    const body = (await blocked.json()) as RateLimitErrorBody;
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('RATE_LIMIT_EXCEEDED');
    expect(body.error.details?.retryAfter).toBeGreaterThan(0);
  });

  test('the key generator isolates callers — one key exhausting does not 429 another', async () => {
    const a = makeApp({ windowMs: 60_000, limit: 1, key: 'k-userA' });
    const b = makeApp({ windowMs: 60_000, limit: 1, key: 'k-userB' });
    expect((await a.request('/ping')).status).toBe(200);
    expect((await a.request('/ping')).status).toBe(429);
    expect((await b.request('/ping')).status).toBe(200);
  });

  test('once the window elapses, a fresh window opens and requests pass again', async () => {
    const app = makeApp({ windowMs: 1000, limit: 1, key: 'k-reset' });
    try {
      setSystemTime(new Date('2024-01-01T00:00:00.000Z'));
      expect((await app.request('/ping')).status).toBe(200);
      expect((await app.request('/ping')).status).toBe(429);

      setSystemTime(new Date('2024-01-01T00:00:02.000Z'));
      expect((await app.request('/ping')).status).toBe(200);
    } finally {
      setSystemTime();
    }
  });
});

describe('rate-limit middleware — bounded store', () => {
  test('the store never holds more than maxTrackedKeys keys, evicting the oldest first', async () => {
    const limits = CONFIG.rateLimit as { maxTrackedKeys: number };
    const previous = limits.maxTrackedKeys;
    limits.maxTrackedKeys = 3;
    try {
      let key = '';
      const app = new Hono();
      app.use('*', rateLimiter({ windowMs: 60_000, limit: 1, keyGenerator: () => key }));
      app.get('/ping', (c: Context) => c.json({ ok: true }));
      for (const next of ['cap-a', 'cap-b', 'cap-c', 'cap-d', 'cap-e']) {
        key = next;
        expect((await app.request('/ping')).status).toBe(200);
      }
      expect(trackedRateLimitKeys()).toBe(limits.maxTrackedKeys);
      key = 'cap-e';
      expect((await app.request('/ping')).status).toBe(429);
      key = 'cap-a';
      expect((await app.request('/ping')).status).toBe(200);
    } finally {
      limits.maxTrackedKeys = previous;
    }
  });
});

describe('concurrency limiter', () => {
  function gatedApp(limit: number) {
    const gates: (() => void)[] = [];
    const app = new Hono();
    app.use(
      '*',
      concurrencyLimiter({ limit, keyGenerator: () => 'k', message: 'busy', status: 503 })
    );
    app.get('/slow', async (c) => {
      await new Promise<void>((release) => gates.push(release));
      return c.json({ ok: true });
    });
    app.get('/fail', () => {
      throw new Error('boom');
    });
    const releaseAll = () => {
      for (const release of gates.splice(0)) release();
    };
    return { app, releaseAll };
  }

  test('a request over the in-flight limit is refused until one finishes', async () => {
    const { app, releaseAll } = gatedApp(2);
    const first = app.request('/slow');
    const second = app.request('/slow');
    await Bun.sleep(5);
    const third = await app.request('/slow');
    expect(third.status).toBe(503);
    expect(third.headers.get('Retry-After')).toBe('5');
    releaseAll();
    expect((await first).status).toBe(200);
    expect((await second).status).toBe(200);
    const fourth = app.request('/slow');
    await Bun.sleep(5);
    releaseAll();
    expect((await fourth).status).toBe(200);
  });

  test('a request that fails still frees its slot', async () => {
    const { app } = gatedApp(1);
    expect((await app.request('/fail')).status).toBe(500);
    expect((await app.request('/fail')).status).toBe(500);
  });
});
