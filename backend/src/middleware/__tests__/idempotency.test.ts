/**
 * Characterization net for the idempotency middleware (guard, cycle 105).
 *
 * This is the double-charge / duplicate-record guard (money-relevant) and sat at 43% coverage —
 * the caching/replay/TTL core was never directly tested (only the required-key 400 path, via
 * sync-route-errors.test.ts at the route level). These tests pin the full contract through a minimal
 * Hono app (the error-handler.test.ts convention), using a per-app counter to observe whether the
 * handler ACTUALLY ran — a replayed cache hit must NOT increment it:
 *   1. method gating — only POST/PUT/DELETE/PATCH are guarded; GET passes through untouched,
 *   2. key gating — missing key throws when required, passes through when optional,
 *   3. cache-hit replay — a duplicate request returns the cached body without re-running the handler,
 *   4. user-scoping — two users sharing one key do NOT collide (the `${userId}:${key}` store key),
 *   5. only-cache-2xx — a 5xx is NOT cached (a transient failure must not be replayed forever),
 *   6. TTL expiry — an entry older than the TTL is dropped, so the handler runs again.
 *
 * The store is a module-level singleton shared across the process, so every test uses a UNIQUE
 * Idempotency-Key to stay isolated.
 */

import { describe, expect, setSystemTime, test } from 'bun:test';
import { type Context, Hono } from 'hono';
import type { AuthUser } from '../../api/auth/lucia';
import { SyncErrorCode } from '../../errors';
import { errorHandler } from '../error-handler';
import { idempotency } from '../idempotency';

interface CountBody {
  count: number;
}
interface ErrorBody {
  success: boolean;
  error: { code: string; message: string };
}

/**
 * Build a minimal app: an optional user-setter → the idempotency middleware → a counting handler.
 * `getCount()` reveals how many times the handler body executed; a cache replay leaves it unchanged.
 * `failStatus`, when set, makes the handler return that status (to exercise the only-cache-2xx branch).
 */
function makeApp(
  opts: { required?: boolean; userId?: string; failStatus?: number; nonJsonBody?: boolean } = {}
) {
  const app = new Hono();
  app.onError(errorHandler);
  let count = 0;

  if (opts.userId) {
    const uid = opts.userId;
    app.use('*', async (c, next) => {
      c.set('user', { id: uid } as unknown as AuthUser);
      return next();
    });
  }
  app.use('*', idempotency({ required: opts.required }));

  const handle = (c: Context) => {
    count += 1;
    if (opts.failStatus) {
      return c.json(
        { success: false, error: { code: 'BOOM', message: 'fail' } },
        opts.failStatus as never
      );
    }
    if (opts.nonJsonBody) {
      // A 2xx NON-JSON body (e.g. a CSV export) — response.json() would throw on this.
      return c.body('id,amount\nx,1', 200, { 'content-type': 'text/csv' });
    }
    return c.json({ count });
  };
  app.post('/op', handle);
  app.get('/op', handle);

  return { app, getCount: () => count };
}

const JSON_HEADERS = { 'content-type': 'application/json' };

describe('idempotency middleware — method & key gating', () => {
  test('GET (non-mutating) bypasses idempotency entirely — never cached', async () => {
    const { app, getCount } = makeApp();
    const headers = { ...JSON_HEADERS, 'Idempotency-Key': 'k-get' };
    await app.request('/op', { method: 'GET', headers });
    await app.request('/op', { method: 'GET', headers });
    // Both GETs run the handler; a key on a safe method is ignored.
    expect(getCount()).toBe(2);
  });

  test('a missing key with required:false passes through (no caching possible without a key)', async () => {
    const { app, getCount } = makeApp();
    await app.request('/op', { method: 'POST', headers: JSON_HEADERS });
    await app.request('/op', { method: 'POST', headers: JSON_HEADERS });
    expect(getCount()).toBe(2);
  });

  test('a missing key with required:true throws a 400 VALIDATION_ERROR', async () => {
    const { app, getCount } = makeApp({ required: true });
    const res = await app.request('/op', { method: 'POST', headers: JSON_HEADERS });
    expect(res.status).toBe(400);
    const body = (await res.json()) as ErrorBody;
    expect(body.success).toBe(false);
    expect(body.error.code).toBe(SyncErrorCode.VALIDATION_ERROR);
    // The handler must never run when the required key is absent.
    expect(getCount()).toBe(0);
  });
});

describe('idempotency middleware — caching contract', () => {
  test('a duplicate POST replays the cached response without re-running the handler', async () => {
    const { app, getCount } = makeApp();
    const headers = { ...JSON_HEADERS, 'Idempotency-Key': 'k-replay' };

    const first = await app.request('/op', { method: 'POST', headers });
    expect(first.status).toBe(200);
    expect(((await first.json()) as CountBody).count).toBe(1);
    expect(getCount()).toBe(1);

    const second = await app.request('/op', { method: 'POST', headers });
    expect(second.status).toBe(200);
    // Replayed body is byte-for-byte the first response (count:1), and the handler did NOT run again.
    expect(((await second.json()) as CountBody).count).toBe(1);
    expect(getCount()).toBe(1);
  });

  test('the store key is user-scoped — two users sharing one key do not collide', async () => {
    const sharedKey = { ...JSON_HEADERS, 'Idempotency-Key': 'k-shared' };
    const userA = makeApp({ userId: 'user-a' });
    const userB = makeApp({ userId: 'user-b' });

    await userA.app.request('/op', { method: 'POST', headers: sharedKey });
    // User B's identical key must NOT hit user A's cache entry — B's handler runs fresh.
    await userB.app.request('/op', { method: 'POST', headers: sharedKey });

    expect(userA.getCount()).toBe(1);
    expect(userB.getCount()).toBe(1);
  });

  test('a non-2xx response is NOT cached — a transient failure is not replayed forever', async () => {
    const { app, getCount } = makeApp({ failStatus: 500 });
    const headers = { ...JSON_HEADERS, 'Idempotency-Key': 'k-fail' };

    const first = await app.request('/op', { method: 'POST', headers });
    expect(first.status).toBe(500);
    expect(getCount()).toBe(1);

    // Second request must re-run (the 500 was not cached), giving the operation another chance.
    const second = await app.request('/op', { method: 'POST', headers });
    expect(second.status).toBe(500);
    expect(getCount()).toBe(2);
  });

  test('a non-JSON 2xx body does NOT 500 and is NOT cached — the dup safely re-runs (C315)', async () => {
    // The middleware clones + JSON-parses the body to cache it. A 2xx NON-JSON response (CSV/binary/
    // 204) would make response.json() THROW, turning a SUCCESSFUL response into a 500 — and a cached
    // non-JSON body couldn't round-trip through the replay c.json() anyway. The guard parses
    // defensively: a non-JSON 2xx is left UNCACHED (so the dup just re-runs — safe degradation), and
    // the original response passes through untouched. No idempotency route returns non-JSON today;
    // this pins the contract so adding one can't regress into a 500.
    const { app, getCount } = makeApp({ nonJsonBody: true });
    const headers = { 'Idempotency-Key': 'k-nonjson' };

    const first = await app.request('/op', { method: 'POST', headers });
    expect(first.status, 'a non-JSON 2xx must NOT be turned into a 500').toBe(200);
    expect(await first.text()).toContain('id,amount');
    expect(getCount()).toBe(1);

    // Not cached (couldn't be JSON-parsed) → the duplicate re-runs the handler rather than replaying.
    const second = await app.request('/op', { method: 'POST', headers });
    expect(second.status).toBe(200);
    expect(getCount()).toBe(2);
  });

  test('an entry older than the TTL is dropped — the handler runs again', async () => {
    const { app, getCount } = makeApp();
    const headers = { ...JSON_HEADERS, 'Idempotency-Key': 'k-ttl' };
    try {
      setSystemTime(new Date('2024-01-01T00:00:00.000Z'));
      await app.request('/op', { method: 'POST', headers });
      expect(getCount()).toBe(1);

      // Advance 25h — past the 24h TTL. The cached entry is stale and must be evicted on read.
      setSystemTime(new Date('2024-01-02T01:00:00.000Z'));
      await app.request('/op', { method: 'POST', headers });
      expect(getCount()).toBe(2);
    } finally {
      setSystemTime();
    }
  });
});
