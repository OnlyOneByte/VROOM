import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  createTestApp,
  type DataEnvelope,
  json,
  ON_POSTGRES,
  SETUP_TIMEOUT_MS,
  type TestApp,
} from '../http-client';

let ctx: TestApp;

beforeEach(async () => {
  ctx = await createTestApp();
}, SETUP_TIMEOUT_MS);

afterEach(() => {
  ctx.close();
});

describe('createTestApp harness', () => {
  test('authed GET /api/v1/auth/me returns the seeded user', async () => {
    const res = await ctx.authed('GET', '/api/v1/auth/me');
    expect(res.status).toBe(200);
    const body = await json<DataEnvelope<{ user: { id: string; email: string } }>>(res);
    expect(body.data.user.id).toBe(ctx.user.id);
    expect(body.data.user.email).toBe(ctx.user.email);
  });

  test('anonymous GET /api/v1/auth/me is unauthorized', async () => {
    const res = await ctx.anon('GET', '/api/v1/auth/me');
    expect(res.status).toBe(401);
  });

  test('authed GET /api/v1/reminders returns an empty list for a fresh user', async () => {
    const res = await ctx.authed('GET', '/api/v1/reminders');
    expect(res.status).toBe(200);
    const body = await json<DataEnvelope<unknown[]>>(res);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data).toHaveLength(0);
  });
});

describe.skipIf(!ON_POSTGRES)('Postgres reset between test apps', () => {
  test('empties every written table and restarts used sequences', async () => {
    await ctx.sql.run(
      "INSERT INTO vehicles (id, user_id, make, model, year) VALUES ('reset-car', ?, 'M', 'X', 2020)",
      [ctx.user.id]
    );
    await ctx.sql.get("SELECT nextval('server_settings_id_seq') AS id");
    await ctx.sql.get("SELECT nextval('server_settings_id_seq') AS id");

    ctx = await createTestApp();

    expect(await ctx.sql.all('SELECT id FROM vehicles')).toEqual([]);
    expect(await ctx.sql.all('SELECT id FROM users')).toEqual([{ id: ctx.user.id }]);
    const next = await ctx.sql.get<{ id: number }>(
      "SELECT nextval('server_settings_id_seq') AS id"
    );
    expect(next?.id).toBe(1);
  });
});
