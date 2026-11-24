import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createTestApp, type TestApp } from '../test-helpers/http-client';

describe('API responses are never stored by a browser or a shared cache', () => {
  let ctx: TestApp;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(() => ctx.close());

  test('a signed-in JSON response is private, no-store', async () => {
    const res = await ctx.authed('GET', '/api/v1/vehicles');
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
  });

  test('an error response is private, no-store too', async () => {
    const res = await ctx.app.request('/api/v1/vehicles');
    expect(res.status).toBe(401);
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
  });

  test('a route that sets its own Cache-Control keeps it', async () => {
    const created = await ctx.authed('POST', '/api/v1/calendar/feed', {});
    const { path } = ((await created.json()) as { data: { path: string } }).data;
    const res = await ctx.app.request(path.startsWith('/api/') ? path : `/api/v1${path}`);
    expect(res.headers.get('Cache-Control')).toBe('private, max-age=900');
  });
});
