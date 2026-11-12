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
  setPhotosServiceBuilderForTest(
    () => new GooglePhotosService('fake-token', makeFakePhotosClient(store), 'album-vroom')
  );
});
afterEach(() => {
  setPhotosServiceBuilderForTest(null);
  globalThis.fetch = realFetch;
  ctx.close();
});

function stubVlm(content: string): void {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      // biome-ignore lint/suspicious/noExplicitAny: test fetch stub.
    })) as any;
}

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

describe('GET /api/v1/photos/receipt-drafts', () => {
  test('no google-photos provider → 400 with an actionable message', async () => {
    await seedVlmProvider();
    const res = await ctx.authed('GET', '/api/v1/photos/receipt-drafts');
    expect(res.status).toBe(400);
    expect(await res.text()).toMatch(/Google Photos|Settings/i);
  });

  test('a google-photos provider but no vlm provider → 400 with an actionable message', async () => {
    seedPhotosProvider();
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
    expect(drafts[0]?.draft.amount).toBe(23.45);
    expect(drafts[0]?.thumbnailUrl).toContain(drafts[0]?.photoId);
    const count = (ctx.sqlite.query('SELECT COUNT(*) as n FROM expenses').get() as { n: number }).n;
    expect(count).toBe(0);
  });

  test('an already-imported photo is filtered out', async () => {
    seedPhotosProvider();
    await seedVlmProvider();
    const ids = store.seedSearchablePhotos([{ filename: 'a.jpg' }, { filename: 'b.jpg' }]);
    const vehicleId = await seedVehicle(ctx, { make: 'Honda', model: 'Civic', year: 2020 });
    stubVlm('{"amount": 10}');
    ctx.sqlite.run(
      `INSERT INTO expenses (id, user_id, vehicle_id, category, expense_amount, date, client_id)
       VALUES ('exp-imported', ?, ?, 'misc', 1000, '2026-05-01', ?)`,
      [ctx.user.id, vehicleId, `photos:${ids[0]}`]
    );

    const { status, drafts } = await getDrafts();
    expect(status).toBe(200);
    expect(drafts.map((d) => d.photoId)).toEqual([ids[1]]);
  });

  test('a Photos transport failure → 502 (honest, never a faked empty result)', async () => {
    seedPhotosProvider();
    await seedVlmProvider();
    store.seedSearchablePhotos([{ filename: 'x.jpg' }]);
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
