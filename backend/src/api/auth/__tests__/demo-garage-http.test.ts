import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import type { Session } from 'lucia';
import { appContext } from '../../../app-context';
import { CONFIG } from '../../../config';
import { getDb } from '../../../db/connection';
import { sessions, users } from '../../../db/schema';
import { createTestApp, json, socketFrom, type TestApp } from '../../../test-helpers/http-client';
import { seedVehicle } from '../../../test-helpers/seed';
import { DEMO_USER_ID, prepareDemoGarage } from '../demo';
import { setSessionCookie } from '../utils';

const db = getDb();

const demoConfig = CONFIG.demo as { enabled: boolean };
let ctx: TestApp;
let visitor = 0;

async function startDemo(ip = `198.51.100.${++visitor}`): Promise<Response> {
  return await ctx.app.request(
    '/api/v1/auth/demo',
    { method: 'POST', headers: { 'Sec-Fetch-Site': 'same-origin' } },
    socketFrom(ip)
  );
}

async function send(
  cookie: string,
  method: string,
  path: string,
  body?: unknown
): Promise<Response> {
  const headers: Record<string, string> = { 'Sec-Fetch-Site': 'same-origin', Cookie: cookie };
  if (body === undefined) return await ctx.app.request(path, { method, headers });
  headers['Content-Type'] = 'application/json';
  return await ctx.app.request(path, { method, headers, body: JSON.stringify(body) });
}

async function demoCookie(): Promise<string> {
  const res = await startDemo();
  expect(res.status).toBe(200);
  const setCookie = res.headers.get('set-cookie') ?? '';
  const maxAge = Number(/Max-Age=(\d+)/i.exec(setCookie)?.[1]);
  expect(maxAge).toBeLessThanOrEqual(CONFIG.demo.sessionDuration / 1000);
  return setCookie.split(';')[0];
}

async function rowCounts(): Promise<Record<string, number>> {
  const tables = ctx.sqlite
    .query(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT IN ('__drizzle_migrations', 'sessions')"
    )
    .all() as { name: string }[];
  return Object.fromEntries(
    tables.map(({ name }) => [
      name,
      (ctx.sqlite.query(`SELECT COUNT(*) AS n FROM "${name}"`).get() as { n: number }).n,
    ])
  );
}

beforeEach(async () => {
  ctx = await createTestApp();
});

afterEach(() => {
  demoConfig.enabled = false;
});

describe('demo garage, off by default', () => {
  test('the setting is off unless DEMO_MODE turns it on', () => {
    expect(CONFIG.demo.enabled).toBe(false);
  });

  test('reports itself unavailable and refuses to start a session', async () => {
    await prepareDemoGarage();
    const status = await json<{ data: { available: boolean } }>(
      await ctx.anon('GET', '/api/v1/auth/demo')
    );
    expect(status.data.available).toBe(false);
    expect((await startDemo()).status).toBe(404);
    expect(await db.select().from(users).where(eq(users.id, DEMO_USER_ID))).toEqual([]);
  });
});

describe('demo garage, on', () => {
  beforeEach(async () => {
    demoConfig.enabled = true;
    await prepareDemoGarage();
  });

  test('a visitor gets a short session on the seeded garage', async () => {
    expect(
      (await json<{ data: { available: boolean } }>(await ctx.anon('GET', '/api/v1/auth/demo')))
        .data.available
    ).toBe(true);
    const cookie = await demoCookie();
    const me = await json<{ data: { demo: boolean; session: { expiresAt: string } } }>(
      await send(cookie, 'GET', '/api/v1/auth/me')
    );
    expect(me.data.demo).toBe(true);
    expect(new Date(me.data.session.expiresAt).getTime()).toBeLessThanOrEqual(
      Date.now() + CONFIG.demo.sessionDuration
    );
    const vehicles = await json<{ data: { nickname: string }[] }>(
      await send(cookie, 'GET', '/api/v1/vehicles')
    );
    expect(vehicles.data.map((v) => v.nickname).sort()).toEqual(['Daily Driver', 'Weekend Car']);
  });

  test('every mutating route refuses the demo user and nothing is written', async () => {
    const cookie = await demoCookie();
    const before = await rowCounts();
    const mutating = ctx.app.routes.filter(
      (r) => !['GET', 'HEAD', 'OPTIONS', 'ALL'].includes(r.method) && r.path.startsWith('/api/v1/')
    );
    expect(mutating.length).toBeGreaterThan(50);
    for (const route of mutating) {
      const path = route.path.replace(/:[^/]+/g, 'x');
      if (path === '/api/v1/auth/logout' || path === '/api/v1/auth/refresh') continue;
      const res = await send(cookie, route.method, path, {});
      expect(`${route.method} ${path} ${res.status}`).toBe(`${route.method} ${path} 403`);
      expect((await json<{ error: { code: string } }>(res)).error.code).toBe('DEMO_READ_ONLY');
    }
    expect((await send(cookie, 'POST', '/api/vehicles', {})).status).toBe(403);
    expect(await rowCounts()).toEqual(before);
  });

  test('provider, backup, share, export and assistant reads are closed too', async () => {
    const cookie = await demoCookie();
    for (const path of [
      '/api/v1/providers',
      '/api/v1/sync/status',
      '/api/v1/sync/backups/download',
      '/api/v1/shares/received',
      '/api/v1/expenses/export',
      '/api/v1/auth/accounts',
      '/api/v1/auth/link/google',
      '/api/v1/auth/callback/link/google',
      '/api/v1/auth/callback/provider/google',
      '/api/v1/auth/providers/connect/google',
      '/api/providers',
    ]) {
      expect(`${path} ${(await send(cookie, 'GET', path)).status}`).toBe(`${path} 403`);
    }
    for (const path of ['/API/V1/Providers', '/api//v1/providers', '/api/v1/providers/']) {
      expect(`${path} ${(await send(cookie, 'GET', path)).status}`).not.toBe(`${path} 200`);
    }
  });

  test("the demo user can't see or reach another user's data", async () => {
    const realVehicleId = await seedVehicle(ctx, { nickname: 'Real car' });
    const cookie = await demoCookie();
    const vehicles = await json<{ data: { id: string }[] }>(
      await send(cookie, 'GET', '/api/v1/vehicles')
    );
    expect(vehicles.data.map((v) => v.id)).not.toContain(realVehicleId);
    expect((await send(cookie, 'GET', `/api/v1/vehicles/${realVehicleId}`)).status).toBe(404);
    expect(
      (await send(cookie, 'GET', `/api/v1/expenses?vehicleId=${realVehicleId}`)).status
    ).not.toBe(200);
    const own = await json<{ data: { id: string }[] }>(await ctx.authed('GET', '/api/v1/vehicles'));
    expect(own.data.map((v) => v.id)).toEqual([realVehicleId]);
  });

  test('starting a demo session is rate-limited like sign-in', async () => {
    const statuses: number[] = [];
    for (let i = 0; i <= CONFIG.rateLimit.auth.limit; i++) {
      statuses.push((await startDemo('203.0.113.9')).status);
    }
    expect(statuses.slice(0, -1).every((s) => s === 200)).toBe(true);
    expect(statuses.at(-1)).toBe(429);
  });

  test('behind a trusted proxy, a new forged X-Forwarded-For each time does not reset the limit', async () => {
    const limits = CONFIG.rateLimit as { trustedProxyIps: readonly string[] };
    const previous = limits.trustedProxyIps;
    limits.trustedProxyIps = ['172.16.0.0/12'];
    const viaProxy = (forwardedFor: string) =>
      ctx.app.request(
        '/api/v1/auth/demo',
        {
          method: 'POST',
          headers: { 'Sec-Fetch-Site': 'same-origin', 'X-Forwarded-For': forwardedFor },
        },
        socketFrom('172.18.0.2')
      );
    try {
      const statuses: number[] = [];
      for (let i = 0; i <= CONFIG.rateLimit.auth.limit; i++) {
        statuses.push((await viaProxy(`10.9.${i}.1, 203.0.113.44`)).status);
      }
      expect(statuses.slice(0, -1).every((s) => s === 200)).toBe(true);
      expect(statuses.at(-1)).toBe(429);
      expect((await viaProxy('10.9.0.1, 203.0.113.45')).status).toBe(200);
    } finally {
      limits.trustedProxyIps = previous;
    }
  });

  test('a restart rebuilds the garage and ends every demo session', async () => {
    const cookie = await demoCookie();
    await prepareDemoGarage();
    expect((await send(cookie, 'GET', '/api/v1/vehicles')).status).toBe(401);
    expect(await db.select().from(users).where(eq(users.id, DEMO_USER_ID))).toHaveLength(1);
  });

  test('a demo session expires after its hour, however often it is used', async () => {
    const stale = `demo_${Date.now() - CONFIG.demo.sessionDuration - 1000}_stale`;
    await appContext().lucia.createSession(DEMO_USER_ID, {}, { sessionId: stale });
    const res = await send(
      `${appContext().lucia.sessionCookieName}=${stale}`,
      'GET',
      '/api/v1/vehicles'
    );
    expect(res.status).toBe(401);
    expect(await db.select().from(sessions).where(eq(sessions.id, stale))).toEqual([]);

    const cookie = await demoCookie();
    const refreshed = await json<{ data: { session: { expiresAt: string } } }>(
      await send(cookie, 'POST', '/api/v1/auth/refresh')
    );
    expect(new Date(refreshed.data.session.expiresAt).getTime()).toBeLessThanOrEqual(
      Date.now() + CONFIG.demo.sessionDuration
    );
  });

  test('the hour holds for any session check, and validating never stretches it', async () => {
    const stale = `demo_${Date.now() - CONFIG.demo.sessionDuration - 1000}_stale`;
    await appContext().lucia.createSession(DEMO_USER_ID, {}, { sessionId: stale });
    expect((await appContext().lucia.validateSession(stale)).session).toBeNull();
    expect(await db.select().from(sessions).where(eq(sessions.id, stale))).toEqual([]);

    const live = (await demoCookie()).split('=')[1];
    expect((await appContext().lucia.validateSession(live)).user?.id).toBe(DEMO_USER_ID);
    const [row] = await db.select().from(sessions).where(eq(sessions.id, live));
    expect(row.expiresAt * 1000).toBeLessThanOrEqual(Date.now() + CONFIG.demo.sessionDuration);
    await appContext().lucia.validateSession(live);
    const [after] = await db.select().from(sessions).where(eq(sessions.id, live));
    expect(after.expiresAt).toBe(row.expiresAt);
  });

  test('a demo cookie never outlives the hour, whatever expiry it is handed', async () => {
    const live = (await demoCookie()).split('=')[1];
    const { session } = await appContext().lucia.validateSession(live);
    const app = new Hono().get('/', (c) => {
      setSessionCookie(c, appContext().lucia.sessionCookieName, session as Session);
      return c.body(null, 204);
    });
    const cookie = (await app.request('/')).headers.get('set-cookie') ?? '';
    expect(Number(/Max-Age=(\d+)/i.exec(cookie)?.[1])).toBeLessThanOrEqual(
      CONFIG.demo.sessionDuration / 1000
    );
    const expires = new Date(/Expires=([^;]+)/i.exec(cookie)?.[1] ?? '').getTime();
    expect(expires).toBeLessThanOrEqual(Date.now() + CONFIG.demo.sessionDuration);
  });

  test('starting a demo session clears expired ones', async () => {
    const stale = `demo_${Date.now() - CONFIG.demo.sessionDuration - 1000}_stale`;
    await appContext().lucia.createSession(DEMO_USER_ID, {}, { sessionId: stale });
    await demoCookie();
    const left = await db.select().from(sessions).where(eq(sessions.userId, DEMO_USER_ID));
    expect(left.map((s) => s.id)).not.toContain(stale);
    expect(left).toHaveLength(1);
  });

  test('a rebuild that fails partway leaves no demo account behind', async () => {
    ctx.sqlite.exec(
      `CREATE TRIGGER fail_demo_seed BEFORE INSERT ON vehicles WHEN NEW.user_id = '${DEMO_USER_ID}' BEGIN SELECT RAISE(ABORT, 'seed failed'); END`
    );
    try {
      await expect(prepareDemoGarage()).rejects.toThrow();
    } finally {
      ctx.sqlite.exec('DROP TRIGGER fail_demo_seed');
    }
    expect(await db.select().from(users).where(eq(users.id, DEMO_USER_ID))).toEqual([]);
    const leftovers = ctx.sqlite
      .query("SELECT COUNT(*) AS n FROM user_preferences WHERE user_id = 'demo-garage'")
      .get() as { n: number };
    expect(leftovers.n).toBe(0);
    expect((await startDemo()).status).toBe(404);
  });

  test('if the clean-up after a failed rebuild also fails, the seeding error still surfaces', async () => {
    await db.delete(users).where(eq(users.id, DEMO_USER_ID));
    ctx.sqlite.exec(
      `CREATE TRIGGER fail_demo_seed BEFORE INSERT ON vehicles WHEN NEW.user_id = '${DEMO_USER_ID}' BEGIN SELECT RAISE(ABORT, 'seed failed'); END`
    );
    ctx.sqlite.exec(
      `CREATE TRIGGER fail_demo_cleanup BEFORE DELETE ON users WHEN OLD.id = '${DEMO_USER_ID}' BEGIN SELECT RAISE(ABORT, 'cleanup failed'); END`
    );
    try {
      await expect(prepareDemoGarage()).rejects.toThrow('seed failed');
    } finally {
      ctx.sqlite.exec('DROP TRIGGER fail_demo_seed');
      ctx.sqlite.exec('DROP TRIGGER fail_demo_cleanup');
    }
    expect((await startDemo()).status).toBe(404);
  });
});
