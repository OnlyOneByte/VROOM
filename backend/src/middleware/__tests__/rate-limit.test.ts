/**
 * Characterization net for the rate-limit middleware (guard, cycle 112).
 *
 * The abuse-prevention middleware sat at 60% line — the limit-exceeded 429 path (with its Retry-After
 * + X-RateLimit-* headers, a contract the client may read) and the window-reset path were uncovered.
 * These pin the full contract through a minimal Hono app (the error-handler/idempotency convention),
 * driving requests against a tiny window + limit passed directly to `rateLimiter(config)`:
 *   1. first request opens the window (count=1) and passes,
 *   2. requests UP TO the limit pass; the one OVER returns 429 with the documented headers,
 *   3. a 429's body carries RATE_LIMIT_EXCEEDED + retryAfter,
 *   4. the per-key generator isolates callers (one key's exhaustion doesn't 429 another),
 *   5. once the window elapses (resetTime < now) a fresh window opens and requests pass again.
 *
 * `windowMs`/`limit`/`keyGenerator` come from the config ARG (not a frozen CONFIG singleton), so the
 * harness controls them directly. The one CONFIG dependency is `disableRateLimit` (the E2E opt-out):
 * it defaults false in the test process (DISABLE_RATE_LIMIT is set by nothing in the repo), but we
 * GUARD on it so this net can never silently go vacuous (the C77/C91 trap). Each test uses a unique
 * key prefix since the store is a module-level singleton shared across the process.
 */

import { describe, expect, setSystemTime, test } from 'bun:test';
import { type Context, Hono } from 'hono';
import { CONFIG } from '../../config';
import { rateLimiter } from '../rate-limit';

interface RateLimitErrorBody {
  success: boolean;
  error: { code: string; message: string; details?: { retryAfter?: number } };
}

/** Minimal app: a fixed-key rate limiter (tiny window+limit) in front of a trivial 200 handler. */
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

// Guard: if the E2E opt-out is ever active in the test process, every assertion below would vacuously
// pass (the limiter just calls next()). Fail loudly instead of lying green.
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
    // The 4th request in the same window is over the limit.
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
    expect((await a.request('/ping')).status).toBe(429); // A is now exhausted
    // B has its own bucket → still allowed.
    expect((await b.request('/ping')).status).toBe(200);
  });

  test('once the window elapses, a fresh window opens and requests pass again', async () => {
    const app = makeApp({ windowMs: 1000, limit: 1, key: 'k-reset' });
    try {
      setSystemTime(new Date('2024-01-01T00:00:00.000Z'));
      expect((await app.request('/ping')).status).toBe(200);
      expect((await app.request('/ping')).status).toBe(429); // still inside the window

      // Advance past the 1s window → resetTime < now → a fresh window opens.
      setSystemTime(new Date('2024-01-01T00:00:02.000Z'));
      expect((await app.request('/ping')).status).toBe(200);
    } finally {
      setSystemTime();
    }
  });
});
