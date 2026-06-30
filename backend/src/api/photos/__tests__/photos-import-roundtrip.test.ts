/**
 * Photos → auto-expense T6 — the full STAGE → CONFIRM → RE-RUN round-trip guard (the merge-surviving half
 * of the feature DoD). The route test (receipt-drafts-route.test.ts) pins the stage endpoint's contract;
 * this pins the OTHER half NORTH_STAR #3 cares about: that a staged draft, confirmed via the UNCHANGED
 * POST /expenses with `clientId = photos:<mediaId>`, PERSISTS — and that a RE-RUN is idempotent: the
 * re-swept photo is now filtered out (the already-imported cross-ref), AND a re-confirm of the same
 * clientId is a no-op (createIdempotent returns the existing row, never a duplicate). The whole
 * FE→BE→re-run seam, end to end, with the live Photos + VLM legs MOCKED (the fake PhotosClient + a stubbed
 * VLM fetch) — the live legs stay the untracked Playwright e2e.
 *
 * Honest contract note: the v1 dedup key is the `photos:<mediaId>` clientId (the shipped createIdempotent
 * unique index) — NOT an expense_receipts photo-ref row. The Photos import creates the parsed-draft
 * expense; the source image stays in the user's Google Photos. So "a re-run is a no-op" is proven via the
 * clientId filter + the idempotent create, which is exactly what design §3 specifies.
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
  // Unique id per call — the shared in-memory DB persists across this file's tests, so a fixed id would
  // collide on the 2nd test (the PK UNIQUE constraint). The userId scope is what the route resolves on.
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
 * Confirm a draft exactly as the T3 client does: POST /expenses with the photos:<id> clientId. Uses a
 * non-fuel category by default (fuel rows additionally require mileage/volume, which is the expense
 * route's own validation — not what this round-trip guard exercises; T6 pins the dedup/idempotency seam).
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

describe('Photos import round-trip: stage → confirm → re-run idempotency (T6)', () => {
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

    // Each created expense carries its photos:<id> clientId (the dedup key, design §3).
    for (const id of ids) {
      const row = ctx.sqlite
        .query('SELECT client_id FROM expenses WHERE client_id = ?')
        .get(`photos:${id}`) as { client_id: string } | null;
      expect(row?.client_id).toBe(`photos:${id}`);
    }
  });

  test('a RE-SWEEP after confirm filters out the now-imported photos (the already-imported cross-ref)', async () => {
    seedPhotosProvider();
    await seedVlmProvider();
    const vehicleId = await seedVehicle(ctx, { make: 'Ford', model: 'F150', year: 2022 });
    const ids = store.seedSearchablePhotos([{ filename: 'a.jpg' }, { filename: 'b.jpg' }]);
    stubVlm('{"amount": 25, "category": "misc"}');

    const first = await sweep();
    expect(first).toHaveLength(2);
    // Confirm ONLY the first photo.
    const firstId = ids[0] as string;
    expect((await confirm(firstId, vehicleId, 25, 'misc')).status).toBe(201);

    // Re-sweep: the confirmed photo is filtered out; only the un-imported one remains.
    const second = await sweep();
    expect(second.map((d) => d.photoId)).toEqual([ids[1]]);
  });

  test('a re-confirm of the same clientId is a NO-OP (idempotent create, never a duplicate)', async () => {
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

    // Re-confirm the SAME photo (e.g. a double-tap / a retried import) → no duplicate row.
    const r2 = await confirm(photoId, vehicleId, 18.5, 'misc');
    expect(r2.status).toBe(201); // idempotent create returns the existing row, still a 2xx
    expect(expenseCount()).toBe(afterFirst); // count UNCHANGED — the crux of D3/R5
  });
});
