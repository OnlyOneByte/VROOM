/**
 * Photos → auto-expense STAGE endpoint (photos-auto-expense T2) — `GET /api/v1/photos/receipt-drafts`,
 * driven through the REAL stack (middleware → requireAuth → handler → provider resolution) via the
 * in-process harness. Pins the HTTP-level contract design §2 specifies:
 *  - no google-photos provider → 400 (actionable);
 *  - a google-photos provider but no vlm provider → 400 (actionable);
 *  - both providers present but the live read is NOT ENABLED yet (the OAuth read scope is ARCC-gated +
 *    ships in T1-live/T5) → 502, the HONEST failure — never a faked empty result (#43/#44/#144);
 *  - unauth → 401.
 *
 * The full multi-photo happy path (download → parse → filter-already-imported → drafts) is pinned by the
 * pure-orchestration test (receipt-drafts-service.test.ts) against injected fakes — the live
 * `mediaItems:search` read the route wires is the ARCC-gated slice that lands later, so the route test
 * deliberately asserts the read-not-enabled 502 rather than stubbing in a live read this slice does not
 * yet own.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createTestApp, type TestApp } from '../../../test-helpers/http-client';
import { encrypt } from '../../../utils/encryption';

let ctx: TestApp;

beforeEach(async () => {
  ctx = await createTestApp();
});
afterEach(() => {
  ctx.close();
});

/** Seed an enabled vlm provider via the REAL create route. */
async function seedVlmProvider(): Promise<void> {
  const res = await ctx.authed('POST', '/api/v1/providers', {
    domain: 'vlm',
    providerType: 'openai-compatible',
    displayName: 'My VLM',
    credentials: { apiKey: 'sk-vlm' },
    config: { model: 'gpt-4o-mini', baseUrl: 'https://api.openai.com/v1' },
  });
  expect(res.status, await res.clone().text()).toBe(201);
}

/**
 * Seed an enabled google-photos storage provider by DIRECT SQL — the generic POST /providers create
 * route does not accept providerType 'google-photos' (it is connected via the OAuth flow, auth/routes),
 * so the test inserts the row directly with encrypted credentials (the deterministic test key the
 * harness sets), matching what the OAuth callback would persist.
 */
function seedPhotosProvider(): void {
  ctx.sqlite.run(
    `INSERT INTO user_providers (id, user_id, domain, provider_type, display_name, credentials, config, status)
     VALUES (?, ?, 'storage', 'google-photos', 'My Photos', ?, ?, 'active')`,
    [
      'photos-prov-1',
      ctx.user.id,
      encrypt(JSON.stringify({ refreshToken: 'refresh-token-abc' })),
      JSON.stringify({ albumId: 'album-vroom' }),
    ]
  );
}

describe('GET /api/v1/photos/receipt-drafts (T2)', () => {
  test('no google-photos provider → 400 with an actionable message', async () => {
    await seedVlmProvider(); // vlm present, photos missing
    const res = await ctx.authed('GET', '/api/v1/photos/receipt-drafts');
    expect(res.status).toBe(400);
    expect(await res.text()).toMatch(/Google Photos|Settings/i);
  });

  test('a google-photos provider but no vlm provider → 400 with an actionable message', async () => {
    seedPhotosProvider(); // photos present, vlm missing
    const res = await ctx.authed('GET', '/api/v1/photos/receipt-drafts');
    expect(res.status).toBe(400);
    expect(await res.text()).toMatch(/VLM|receipt-parsing|Settings/i);
  });

  test('both providers present but the read scope is not enabled yet → 502 (honest, not a fake empty)', async () => {
    seedPhotosProvider();
    await seedVlmProvider();
    // The REAL GooglePhotosService has no searchMediaItems client (the OAuth read scope is ARCC-gated +
    // ships in T1-live/T5), so listReceiptPhotos throws "not enabled" → the route maps it to a 502.
    const res = await ctx.authed('GET', '/api/v1/photos/receipt-drafts');
    expect(res.status).toBe(502);
    // The honest failure surfaces a try-again message, and PERSISTS NOTHING.
    expect(await res.text()).toMatch(/Could not read|try again/i);
    const count = (ctx.sqlite.query('SELECT COUNT(*) as n FROM expenses').get() as { n: number }).n;
    expect(count).toBe(0);
  });

  test('an unauthenticated request is rejected (401)', async () => {
    const res = await ctx.anon('GET', '/api/v1/photos/receipt-drafts');
    expect(res.status).toBe(401);
  });
});
