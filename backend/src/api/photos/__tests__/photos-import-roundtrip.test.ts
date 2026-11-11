/**
 * Receipt import round trip: stage, confirm through POST /expenses with clientId `photos:<mediaId>`,
 * then re-run. A re-run skips imported photos, and re-confirming a clientId never creates a duplicate.
 * Photos and VLM are faked. The dedup key is the clientId; the source image stays in Google Photos.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  FakePhotosStore,
  makeFakePhotosClient,
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
  expect(res.status).toBe(201);
}

let photosProviderSeq = 0;
function seedPhotosProvider(): void {
  // Unique per call: the in-memory DB persists across tests in this file.
  photosProviderSeq += 1;
  ctx.sqlite.run(
    `INSERT INTO user_providers (id, user_id, domain, provider_type, display_name, credentials, config, status)
     VALUES (?, ?, 'storage', 'google-photos', 'My Photos', ?, ?, 'active')`,
    [
      `photos-prov-${photosProviderSeq}`,
      ctx.user.id,
      encrypt(JSON.stringify({ refreshToken: 'rt' })),
      JSON.stringify({ albumId: 'album-vroom' }),
    ]
  );
}

async function sweep(): Promise<ReceiptDraftItem[]> {
  const res = await ctx.authed('GET', '/api/v1/photos/receipt-drafts');
  expect(res.status, await res.clone().text()).toBe(200);
  return (await json<DataEnvelope<{ drafts: ReceiptDraftItem[] }>>(res)).data.drafts;
}

/**
 * Confirms a draft the way the client does: POST /expenses with the photos:<id> clientId. Defaults to
 * a non-fuel category because fuel also requires mileage and volume.
 */
async function confirm(
  photoId: string,
  vehicleId: string,
  amount: number,
  category = 'misc'
): Promise<Response> {
  return ctx.authed('POST', '/api/v1/expenses', {
    vehicleId,
    category,
    expenseAmount: amount,
    date: '2026-03-12',
    clientId: `photos:${photoId}`,
  });
}

function expenseCount(): number {
  return (ctx.sqlite.query('SELECT COUNT(*) as n FROM expenses').get() as { n: number }).n;
}

describe('Photos import round-trip: stage, confirm, re-run', () => {
  test('sweep → confirm N drafts → N expenses persist with the photos:<id> clientId', async () => {
    seedPhotosProvider();
    await seedVlmProvider();
    const vehicleId = await seedVehicle(ctx, { make: 'Honda', model: 'Civic', year: 2021 });
    const ids = store.seedSearchablePhotos([{ filename: 'a.jpg' }, { filename: 'b.jpg' }]);
    stubVlm('{"amount": 30.00, "category": "misc"}');

    const drafts = await sweep();
    expect(drafts.map((d) => d.photoId).sort()).toEqual([...ids].sort());

    const before = expenseCount();
    for (const d of drafts) {
      const res = await confirm(d.photoId, vehicleId, d.draft.amount ?? 30);
      expect(res.status, await res.clone().text()).toBe(201);
    }
    expect(expenseCount()).toBe(before + 2);

    // Each expense keeps its photos:<id> clientId, which is the dedup key.
    for (const id of ids) {
      const row = ctx.sqlite
        .query('SELECT client_id FROM expenses WHERE client_id = ?')
        .get(`photos:${id}`) as { client_id: string } | null;
      expect(row?.client_id).toBe(`photos:${id}`);
    }
  });

  test('a re-sweep after confirm filters out the now-imported photos', async () => {
    seedPhotosProvider();
    await seedVlmProvider();
    const vehicleId = await seedVehicle(ctx, { make: 'Ford', model: 'F150', year: 2022 });
    const ids = store.seedSearchablePhotos([{ filename: 'a.jpg' }, { filename: 'b.jpg' }]);
    stubVlm('{"amount": 25, "category": "misc"}');

    const first = await sweep();
    expect(first).toHaveLength(2);
    const firstId = ids[0] as string;
    expect((await confirm(firstId, vehicleId, 25, 'misc')).status).toBe(201);

    const second = await sweep();
    expect(second.map((d) => d.photoId)).toEqual([ids[1]]);
  });

  test('a re-confirm of the same clientId creates no duplicate', async () => {
    seedPhotosProvider();
    await seedVlmProvider();
    const vehicleId = await seedVehicle(ctx, { make: 'Mazda', model: 'CX5', year: 2023 });
    const ids = store.seedSearchablePhotos([{ filename: 'a.jpg' }]);
    stubVlm('{"amount": 18.5, "category": "misc"}');

    await sweep();
    const photoId = ids[0] as string;
    const r1 = await confirm(photoId, vehicleId, 18.5, 'misc');
    expect(r1.status).toBe(201);
    const afterFirst = expenseCount();

    const r2 = await confirm(photoId, vehicleId, 18.5, 'misc');
    expect(r2.status).toBe(201);
    expect(expenseCount()).toBe(afterFirst);
  });
});
