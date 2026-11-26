import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { errorHandler } from '../../middleware';
import { createTestApp, SETUP_TIMEOUT_MS, type TestApp } from '../../test-helpers/http-client';
import { authorize, ownAccount } from '../authorize';

let ctx: TestApp;

beforeEach(async () => {
  ctx = await createTestApp();
}, SETUP_TIMEOUT_MS);
afterEach(() => ctx.close());

function probe(path: string, mount: string): Hono {
  const child = new Hono();
  child.use('*', async (c, next) => {
    c.set('user', { ...ctx.user, pendingApprovalAt: null, createdAt: null, updatedAt: null });
    await next();
  });
  child.get(path, authorize(ownAccount), (c) => c.text('ok'));
  const app = new Hono();
  app.onError(errorHandler);
  app.route(mount, child);
  return app;
}

describe('authorize()', () => {
  test('a route with no entry in the route map is refused', async () => {
    const res = await probe('/not-mapped', '/api/v1/probe').request('/api/v1/probe/not-mapped');
    expect(res.status).toBe(403);
  });

  test('an entity rule picks its permissions by entity type and refuses unknown types', async () => {
    const app = probe('/:entityType/:entityId', '/api/v1/photos');
    expect((await app.request('/api/v1/photos/insurance_policy/p1')).status).toBe(200);
    expect((await app.request('/api/v1/photos/something_else/p1')).status).toBe(404);
  });

  test('a disabled caller is refused even on their own account', async () => {
    ctx.sqlite.run('UPDATE users SET disabled_at = 1 WHERE id = ?', [ctx.user.id]);
    const app = probe('/:entityType/:entityId', '/api/v1/photos');
    expect((await app.request('/api/v1/photos/vehicle/v1')).status).toBe(403);
  });
});
