// Idempotency contract: method and key gating, cached replay, user scoping, only 2xx cached, and TTL expiry.
// The store is process-wide, so each test uses its own Idempotency-Key.

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

// getCount() reports handler executions, so a cache replay leaves it unchanged.
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
      // response.json() would throw on this body.
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
    expect(((await second.json()) as CountBody).count).toBe(1);
    expect(getCount()).toBe(1);
  });

  test('the store key is user-scoped — two users sharing one key do not collide', async () => {
    const sharedKey = { ...JSON_HEADERS, 'Idempotency-Key': 'k-shared' };
    const userA = makeApp({ userId: 'user-a' });
    const userB = makeApp({ userId: 'user-b' });

    await userA.app.request('/op', { method: 'POST', headers: sharedKey });
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

    const second = await app.request('/op', { method: 'POST', headers });
    expect(second.status).toBe(500);
    expect(getCount()).toBe(2);
  });

  test('a non-JSON 2xx body does NOT 500 and is NOT cached — the dup safely re-runs', async () => {
    const { app, getCount } = makeApp({ nonJsonBody: true });
    const headers = { 'Idempotency-Key': 'k-nonjson' };

    const first = await app.request('/op', { method: 'POST', headers });
    expect(first.status, 'a non-JSON 2xx must NOT be turned into a 500').toBe(200);
    expect(await first.text()).toContain('id,amount');
    expect(getCount()).toBe(1);

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

      // 25h is past the 24h TTL.
      setSystemTime(new Date('2024-01-02T01:00:00.000Z'));
      await app.request('/op', { method: 'POST', headers });
      expect(getCount()).toBe(2);
    } finally {
      setSystemTime();
    }
  });
});
