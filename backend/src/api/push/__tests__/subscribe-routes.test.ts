/**
 * push-notifications T3 — POST/DELETE /api/v1/push/subscribe (HTTP harness).
 *
 * Drives the REAL app over an in-memory DB. Pins the store contract the FE (T5) + the send hook (T4)
 * depend on:
 *   - POST persists a subscription for the SESSION user + reads back via the repo (201, id only —
 *     the crypto keys are never echoed).
 *   - POST is idempotent on (userId, endpoint): a re-subscribe from the same browser updates, never
 *     duplicates.
 *   - DELETE removes the session user's subscription (idempotent — deleting an unknown endpoint is a
 *     clean no-op, not an error).
 *   - IDOR: user B cannot delete user A's subscription via the endpoint alone (the endpoint is not a
 *     capability — the write is scoped to ctx.userId). B's delete is a no-op; A's row survives.
 *   - auth + validation: anon → 401; a malformed body (missing keys) → 400.
 *
 * createTestApp() seeds user A; user B is minted on the same DB (the shares-routes.test.ts pattern).
 * These routes do NOT gate on CONFIG.push.enabled — a user may register a subscription regardless of
 * whether THIS server can currently send (the send hook checks enablement at T4); so the harness (no
 * VAPID env) exercises them fully.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  createTestApp,
  type DataEnvelope,
  json,
  type TestApp,
} from '../../../test-helpers/http-client';
import { pushSubscriptionRepository } from '../repository';

let ctx: TestApp; // user A
let bId: string; // user B
let bCounter = 0;

beforeEach(async () => {
  ctx = await createTestApp();
  const { db } = await import('../../../db/connection');
  const schema = await import('../../../db/schema');
  bId = `push-user-b-${++bCounter}`;
  await db
    .insert(schema.users)
    .values({ id: bId, email: `pushb-${bCounter}@test.com`, displayName: 'B' });
});
afterEach(() => ctx.close());

const SUB = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/device-a',
  keys: { p256dh: 'BPp256dhKeyAAA', auth: 'authSecretAAA' },
  userAgent: 'Chrome on Pixel',
};

/** Act AS user B against the same app (a real minted session, the shares-routes pattern). */
async function asB(method: string, path: string, body?: unknown): Promise<Response> {
  const { lucia } = await import('../../auth/lucia');
  const session = await lucia.createSession(bId, {});
  const sc = lucia.createSessionCookie(session.id);
  const headers: Record<string, string> = {
    Cookie: `${sc.name}=${sc.value}`,
    'Sec-Fetch-Site': 'same-origin',
  };
  let init: RequestInit = { method, headers };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    init = { ...init, body: JSON.stringify(body) };
  }
  return ctx.app.request(path, init);
}

describe('POST /api/v1/push/subscribe (T3)', () => {
  test('persists a subscription for the session user + returns 201 with the id only', async () => {
    const res = await ctx.authed('POST', '/api/v1/push/subscribe', SUB);
    expect(res.status).toBe(201);
    const body = await json<DataEnvelope<{ id: string }>>(res);
    expect(body.data.id).toBeTruthy();

    // The crypto keys are NOT echoed in the response.
    const raw = JSON.stringify(body);
    expect(raw.includes(SUB.keys.p256dh)).toBe(false);
    expect(raw.includes(SUB.keys.auth)).toBe(false);

    // Round-trips through the repo, scoped to user A.
    const stored = await pushSubscriptionRepository.findByUser(ctx.user.id);
    expect(stored).toHaveLength(1);
    expect(stored[0].endpoint).toBe(SUB.endpoint);
    expect(stored[0].p256dh).toBe(SUB.keys.p256dh);
  });

  test('is idempotent on (userId, endpoint) — re-subscribe updates, never duplicates', async () => {
    await ctx.authed('POST', '/api/v1/push/subscribe', SUB);
    await ctx.authed('POST', '/api/v1/push/subscribe', {
      ...SUB,
      keys: { p256dh: 'BProtated', auth: 'authRotated' },
    });
    const stored = await pushSubscriptionRepository.findByUser(ctx.user.id);
    expect(stored).toHaveLength(1);
    expect(stored[0].p256dh).toBe('BProtated');
  });

  test('anon → 401', async () => {
    const res = await ctx.anon('POST', '/api/v1/push/subscribe', SUB);
    expect(res.status).toBe(401);
  });

  test('a malformed body (missing keys) → 400', async () => {
    const res = await ctx.authed('POST', '/api/v1/push/subscribe', { endpoint: SUB.endpoint });
    expect(res.status).toBe(400);
  });
});

describe('DELETE /api/v1/push/subscribe (T3)', () => {
  test('removes the session user subscription (idempotent)', async () => {
    await ctx.authed('POST', '/api/v1/push/subscribe', SUB);

    const res = await ctx.authed('DELETE', '/api/v1/push/subscribe', { endpoint: SUB.endpoint });
    expect(res.status).toBe(200);
    const body = await json<DataEnvelope<{ removed: boolean }>>(res);
    expect(body.data.removed).toBe(true);
    expect(await pushSubscriptionRepository.findByUser(ctx.user.id)).toHaveLength(0);

    // Deleting again (unknown endpoint) is a clean no-op, not an error.
    const again = await ctx.authed('DELETE', '/api/v1/push/subscribe', { endpoint: SUB.endpoint });
    expect(again.status).toBe(200);
    expect((await json<DataEnvelope<{ removed: boolean }>>(again)).data.removed).toBe(false);
  });

  test('IDOR: user B cannot delete user A subscription via the endpoint', async () => {
    await ctx.authed('POST', '/api/v1/push/subscribe', SUB);

    // B tries to delete A's endpoint — no row of B's matches → no-op, and A's row survives.
    const res = await asB('DELETE', '/api/v1/push/subscribe', { endpoint: SUB.endpoint });
    expect(res.status).toBe(200);
    expect((await json<DataEnvelope<{ removed: boolean }>>(res)).data.removed).toBe(false);
    expect(await pushSubscriptionRepository.findByUser(ctx.user.id)).toHaveLength(1);
  });

  test('the same endpoint is per-user — A and B each own their own row', async () => {
    await ctx.authed('POST', '/api/v1/push/subscribe', SUB);
    await asB('POST', '/api/v1/push/subscribe', SUB); // B subscribes the same endpoint string

    // Each user has exactly one, independently.
    expect(await pushSubscriptionRepository.findByUser(ctx.user.id)).toHaveLength(1);
    expect(await pushSubscriptionRepository.findByUser(bId)).toHaveLength(1);

    // A deletes theirs; B's survives (per-user scoping).
    await ctx.authed('DELETE', '/api/v1/push/subscribe', { endpoint: SUB.endpoint });
    expect(await pushSubscriptionRepository.findByUser(ctx.user.id)).toHaveLength(0);
    expect(await pushSubscriptionRepository.findByUser(bId)).toHaveLength(1);
  });
});
