/**
 * GET /api/v1/providers/pending/:nonce route coverage (C257 guard). The route reads the in-memory
 * pending-OAuth-credentials store (utils/pending-credentials) via getPendingEmail(user.id, nonce) —
 * the seam the OAuth callback uses to hand the resolved email to the provider-create UI. The store's
 * unit logic is covered (pending-credentials.test), but the ROUTE slice (auth + the found/not-found
 * branch + the userId:nonce KEY-SCOPING that isolates one user's pending email from another's) was
 * uncovered.
 *
 * pending-credentials is a plain process-global Map (no DB), but createTestApp() dynamic-imports the
 * DB-bound app AFTER rewriting env — so we dynamic-import storePending INSIDE the test (post-harness)
 * to guarantee we seed the SAME module instance the route reads (the C163 same-instance discipline).
 */

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
    // Stored under a DIFFERENT userId; the authed test user must not see it.
    storePending('someone-else', 'shared-nonce', 'tok', 'victim@example.com');

    const res = await ctx.authed('GET', '/api/v1/providers/pending/shared-nonce');
    expect(res.status).toBe(404);
  });

  test('401s an unauthenticated request', async () => {
    const res = await ctx.anon('GET', '/api/v1/providers/pending/any');
    expect(res.status).toBe(401);
  });
});
