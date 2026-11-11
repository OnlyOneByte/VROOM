/**
 * POST and DELETE /api/v1/push/subscribe over the in-memory app. Covers persisting for the session
 * user (id only, keys not echoed), idempotent re-subscribe, DELETE as a no-op for unknown endpoints,
 * IDOR protection between users, and auth and validation errors. These routes do not check whether
 * push is configured.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  createTestApp,
  type DataEnvelope,
  json,
  type RequestFn,
  type TestApp,
} from '../../../test-helpers/http-client';
import { createInvitee } from '../../../test-helpers/invitee';
import { pushSubscriptionRepository } from '../repository';

let ctx: TestApp;
let asB: RequestFn;
let bId: string;

beforeEach(async () => {
  ctx = await createTestApp();
  const b = await createInvitee(ctx, 'push-user-b', 'B');
  bId = b.id;
  asB = b.request;
});
afterEach(() => ctx.close());

const SUB = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/device-a',
  keys: { p256dh: 'BPp256dhKeyAAA', auth: 'authSecretAAA' },
  userAgent: 'Chrome on Pixel',
};

describe('POST /api/v1/push/subscribe', () => {
  test('persists a subscription for the session user and returns 201 with the id only', async () => {
    const res = await ctx.authed('POST', '/api/v1/push/subscribe', SUB);
    expect(res.status).toBe(201);
    const body = await json<DataEnvelope<{ id: string }>>(res);
    expect(body.data.id).toBeTruthy();

    const raw = JSON.stringify(body);
    expect(raw.includes(SUB.keys.p256dh)).toBe(false);
    expect(raw.includes(SUB.keys.auth)).toBe(false);

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

describe('DELETE /api/v1/push/subscribe', () => {
  test('removes the session user subscription (idempotent)', async () => {
    await ctx.authed('POST', '/api/v1/push/subscribe', SUB);

    const res = await ctx.authed('DELETE', '/api/v1/push/subscribe', { endpoint: SUB.endpoint });
    expect(res.status).toBe(200);
    const body = await json<DataEnvelope<{ removed: boolean }>>(res);
    expect(body.data.removed).toBe(true);
    expect(await pushSubscriptionRepository.findByUser(ctx.user.id)).toHaveLength(0);

    const again = await ctx.authed('DELETE', '/api/v1/push/subscribe', { endpoint: SUB.endpoint });
    expect(again.status).toBe(200);
    expect((await json<DataEnvelope<{ removed: boolean }>>(again)).data.removed).toBe(false);
  });

  test('IDOR: user B cannot delete user A subscription via the endpoint', async () => {
    await ctx.authed('POST', '/api/v1/push/subscribe', SUB);

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

    await ctx.authed('DELETE', '/api/v1/push/subscribe', { endpoint: SUB.endpoint });
    expect(await pushSubscriptionRepository.findByUser(ctx.user.id)).toHaveLength(0);
    expect(await pushSubscriptionRepository.findByUser(bId)).toHaveLength(1);
  });
});
