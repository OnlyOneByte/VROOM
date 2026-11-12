import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createTestApp, json, type TestApp } from '../../../test-helpers/http-client';

let ctx: TestApp;

beforeEach(async () => {
  ctx = await createTestApp();
});
afterEach(() => ctx.close());

describe('GET /api/v1/providers/pending/:nonce', () => {
  test('returns the stored email for the user’s own pending nonce', async () => {
    const { storePending } = await import('../../../utils/pending-credentials');
    storePending(ctx.user.id, 'nonce-abc', 'refresh-tok', 'me@example.com');

    const res = await ctx.authed('GET', '/api/v1/providers/pending/nonce-abc');
    const body = await json<{ success: boolean; data: { email: string } }>(res);
    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.data.email).toBe('me@example.com');
  });

  test('404s an unknown nonce', async () => {
    const res = await ctx.authed('GET', '/api/v1/providers/pending/does-not-exist');
    expect(res.status).toBe(404);
  });

  test('404s a nonce stored under ANOTHER user (userId:nonce key-scoping — no cross-user leak)', async () => {
    const { storePending } = await import('../../../utils/pending-credentials');
    storePending('someone-else', 'shared-nonce', 'tok', 'victim@example.com');

    const res = await ctx.authed('GET', '/api/v1/providers/pending/shared-nonce');
    expect(res.status).toBe(404);
  });

  test('401s an unauthenticated request', async () => {
    const res = await ctx.anon('GET', '/api/v1/providers/pending/any');
    expect(res.status).toBe(401);
  });
});
