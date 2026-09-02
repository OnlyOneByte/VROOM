/**
 * Photos → auto-expense STAGE endpoint (photos-auto-expense T2 + T1) — `GET /api/v1/photos/receipt-drafts`,
 * driven through the REAL stack (middleware → requireAuth → handler → provider resolution → orchestration)
 * via the in-process harness. The Photos service is injected with a fake-PhotosClient-backed service
 * (`setPhotosServiceBuilderForTest`) so the live `mediaItems:search` read path (T1) is exercised
 * ZERO-network — the real read needs a Google token the in-process suite cannot mint. The VLM adapter's
 * outbound fetch is stubbed (the same pattern as the assistant/vlm route tests). Pins the §2 contract:
 *  - no google-photos provider → 400 (actionable);
 *  - a google-photos provider but no vlm provider → 400 (actionable);
 *  - both present → a clean multi-photo sweep returns drafts (download → parse → fresh thumbnail), and
 *    an already-imported photo is filtered out (the idempotency cross-ref, D3) — PERSISTS NOTHING;
 *  - a Photos transport failure → 502, the HONEST failure (never a faked empty result, #43/#44/#144);
 *  - unauth → 401.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  FakePhotosStore,
  makeFakePhotosClient,
  photosApiError,
} from '../../../test-helpers/fake-google-photos-client';
import {
  createTestApp,
  type DataEnvelope,
  json,
  type TestApp,
} from '../../../test-helpers/http-client';
import { seedVehicle } from '../../../test-helpers/seed';
import { encrypt } from '../../../utils/encryption';
import { GooglePhotosService } from '../../providers/services/google-photos-service';
import { setPhotosServiceBuilderForTest } from '../receipt-drafts-route';
import type { ReceiptDraftItem } from '../receipt-drafts-service';

let ctx: TestApp;
let store: FakePhotosStore;
const realFetch = globalThis.fetch;

beforeEach(async () => {
  ctx = await createTestApp();
  store = new FakePhotosStore();
  // Inject a fake-PhotosClient-backed service so the live read path runs zero-network. The album id is
  // pre-cached so resolveAlbumId skips list/create; the fake's searchMediaItems paginates the seeded ids.
  setPhotosServiceBuilderForTest(
    () => new GooglePhotosService('fake-token', makeFakePhotosClient(store), 'album-vroom')
  );
});
afterEach(() => {
  setPhotosServiceBuilderForTest(null); // restore the real builder
  globalThis.fetch = realFetch;
  ctx.close();
});

/** Stub the VLM adapter's outbound fetch to return one OpenAI-style completion with `content`. */
function stubVlm(content: string): void {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      // biome-ignore lint/suspicious/noExplicitAny: test fetch stub.
    })) as any;
}

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

async function getDrafts(): Promise<{ status: number; drafts: ReceiptDraftItem[] }> {
  const res = await ctx.authed('GET', '/api/v1/photos/receipt-drafts');
  if (res.status !== 200) return { status: res.status, drafts: [] };
  const body = await json<DataEnvelope<{ drafts: ReceiptDraftItem[] }>>(res);
  return { status: res.status, drafts: body.data.drafts };
}

describe('GET /api/v1/photos/receipt-drafts (T2 + T1 live read)', () => {
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

  test('both providers present → a clean sweep returns one draft per app-created photo, persists nothing', async () => {
    seedPhotosProvider();
    await seedVlmProvider();
    store.seedSearchablePhotos([{ filename: 'r1.jpg' }, { filename: 'r2.jpg' }]);
    stubVlm('{"amount": 23.45, "category": "fuel", "vendor": "Shell"}');

    const { status, drafts } = await getDrafts();
    expect(status).toBe(200);
    expect(drafts).toHaveLength(2);
    // Each carries the source photoId + the parsed draft + a fresh thumbnail URL.
    expect(drafts[0]?.draft.amount).toBe(23.45);
    expect(drafts[0]?.thumbnailUrl).toContain(drafts[0]?.photoId);
    // PERSISTS NOTHING — a stage is read-only; the FE confirms each via POST /expenses later.
    const count = (ctx.sqlite.query('SELECT COUNT(*) as n FROM expenses').get() as { n: number }).n;
    expect(count).toBe(0);
  });

  test('an already-imported photo is filtered out (the idempotency cross-ref, D3)', async () => {
    seedPhotosProvider();
    await seedVlmProvider();
    const ids = store.seedSearchablePhotos([{ filename: 'a.jpg' }, { filename: 'b.jpg' }]);
    const vehicleId = await seedVehicle(ctx, { make: 'Honda', model: 'Civic', year: 2020 });
    stubVlm('{"amount": 10}');
    // Mark the FIRST media item as already backing an expense (clientId = photos:<id>).
    ctx.sqlite.run(
      `INSERT INTO expenses (id, user_id, vehicle_id, category, expense_amount, date, client_id)
       VALUES ('exp-imported', ?, ?, 'misc', 1000, '2026-05-01', ?)`,
      [ctx.user.id, vehicleId, `photos:${ids[0]}`]
    );

    const { status, drafts } = await getDrafts();
    expect(status).toBe(200);
    // Only the SECOND (un-imported) photo is staged.
    expect(drafts.map((d) => d.photoId)).toEqual([ids[1]]);
  });

  test('a Photos transport failure → 502 (honest, never a faked empty result)', async () => {
    seedPhotosProvider();
    await seedVlmProvider();
    store.seedSearchablePhotos([{ filename: 'x.jpg' }]);
    // Arm the live read to throw a 503 — the route must surface it as a 502, not a 200 with [].
    store.injectFault('searchMediaItems', photosApiError(503, 'Google Photos API 503'));
    const res = await ctx.authed('GET', '/api/v1/photos/receipt-drafts');
    expect(res.status).toBe(502);
    expect(await res.text()).toMatch(/Could not read|try again/i);
    const count = (ctx.sqlite.query('SELECT COUNT(*) as n FROM expenses').get() as { n: number }).n;
    expect(count).toBe(0);
  });

  test('an unauthenticated request is rejected (401)', async () => {
    const res = await ctx.anon('GET', '/api/v1/photos/receipt-drafts');
    expect(res.status).toBe(401);
  });
});
