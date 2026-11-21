import { afterEach, describe, expect, test } from 'bun:test';
import { CONFIG } from '../../../config';
import { createTestApp } from '../../../test-helpers/http-client';

const PUBLIC_KEY = 'BPublicKeySentinelValue';
const PRIVATE_KEY = 'PrivateKeySentinelMustNotLeak';

const savedPush = { ...CONFIG.push };

function stubPushConfig(fields: Partial<typeof savedPush>): void {
  Object.assign(CONFIG.push, fields);
}

afterEach(() => {
  stubPushConfig(savedPush);
});

describe('push VAPID public-key route', () => {
  test('unconfigured server → 200 with enabled:false (push off is a normal setup, not an outage)', async () => {
    stubPushConfig({ enabled: false });
    const ctx = await createTestApp();
    const res = await ctx.authed('GET', '/api/v1/push/vapid-public-key');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, data: { enabled: false, publicKey: null } });
    ctx.close();
  });

  test('configured server → 200 with the public key only', async () => {
    stubPushConfig({ enabled: true, vapidPublicKey: PUBLIC_KEY, vapidPrivateKey: PRIVATE_KEY });
    const ctx = await createTestApp();
    const res = await ctx.authed('GET', '/api/v1/push/vapid-public-key');
    const raw = await res.text();
    expect(res.status).toBe(200);
    expect(JSON.parse(raw)).toEqual({
      success: true,
      data: { enabled: true, publicKey: PUBLIC_KEY },
    });
    expect(raw).not.toContain(PRIVATE_KEY);
    ctx.close();
  });

  test('requires auth (anon → 401)', async () => {
    const ctx = await createTestApp();
    const res = await ctx.anon('GET', '/api/v1/push/vapid-public-key');
    expect(res.status).toBe(401);
    ctx.close();
  });
});
