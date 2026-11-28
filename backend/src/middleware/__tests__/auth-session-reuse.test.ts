import { beforeEach, describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import type { AuthUser } from '../../api/auth/lucia';
import { createTestApp, SETUP_TIMEOUT_MS, type TestApp } from '../../test-helpers/http-client';
import { requireAuth } from '../auth';

let ctx: TestApp;

beforeEach(async () => {
  ctx = await createTestApp();
}, SETUP_TIMEOUT_MS);

describe('requireAuth reuses only the session of this request', () => {
  test('a context session for another id is validated against the cookie, not trusted', async () => {
    const app = new Hono();
    app.use('*', async (c, next) => {
      c.set('session', { id: 'some-other-session', expiresAt: new Date(Date.now() + 60_000) });
      c.set('user', { ...(ctx.user as unknown as AuthUser), id: 'someone-else' });
      await next();
    });
    app.get('/whoami', requireAuth, (c) => c.json({ id: c.get('user').id }));

    const res = await app.request('/whoami', { headers: { Cookie: ctx.cookie } });

    expect(res.status).toBe(200);
    expect(((await res.json()) as { id: string }).id).toBe(ctx.user.id);
  });
});
