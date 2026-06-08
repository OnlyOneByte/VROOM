/**
 * Smoke test for the in-process HTTP harness itself (createTestApp).
 * Proves the wiring: in-memory DB + migrations + seeded session reach a real
 * authed route, and that an anonymous request is rejected.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createTestApp, type DataEnvelope, json, type TestApp } from '../http-client';

let ctx: TestApp;

beforeEach(async () => {
  ctx = await createTestApp();
});

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
