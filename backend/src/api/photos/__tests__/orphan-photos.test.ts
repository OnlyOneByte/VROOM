import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  createTestApp,
  type DataEnvelope,
  json,
  type TestApp,
} from '../../../test-helpers/http-client';
import { seedVehicle } from '../../../test-helpers/seed';
import { ENTITY_TO_CATEGORY } from '../../providers/domains/storage/storage-provider';
import { PHOTO_ENTITY_TABLES } from '../photo-repository';
import {
  FAKE_PROVIDER_ID,
  type FakePhotoStorage,
  installFakePhotoStorage,
} from './fake-photo-storage';

let ctx: TestApp;

beforeEach(async () => {
  ctx = await createTestApp();
});
let storage: FakePhotoStorage | undefined;

afterEach(() => {
  storage?.restore();
  storage = undefined;
  ctx.close();
});

function seedPhoto(id: string, userId: string, entityType: string, entityId: string): void {
  ctx.sqlite.run(
    `INSERT INTO photos (id, user_id, entity_type, entity_id, file_name, mime_type, file_size)
     VALUES (?, ?, ?, ?, ?, 'image/jpeg', 1024)`,
    [id, userId, entityType, entityId, `${id}.jpg`]
  );
}

function seedLiveEntities(vehicleId: string): Record<string, string> {
  const userId = ctx.user.id;
  ctx.sqlite.run(
    "INSERT INTO expenses (id, vehicle_id, user_id, category, date, expense_amount) VALUES ('live-expense', ?, ?, 'fuel', 0, 100)",
    [vehicleId, userId]
  );
  ctx.sqlite.run(
    "INSERT INTO odometer_entries (id, vehicle_id, user_id, odometer, recorded_at) VALUES ('live-odometer', ?, ?, 1000, 0)",
    [vehicleId, userId]
  );
  ctx.sqlite.run(
    "INSERT INTO insurance_policies (id, user_id, company) VALUES ('live-policy', ?, 'Acme')",
    [userId]
  );
  ctx.sqlite.run(
    "INSERT INTO insurance_claims (id, policy_id, claim_date, claim_type) VALUES ('live-claim', 'live-policy', 0, 'collision')"
  );
  return {
    vehicle: vehicleId,
    expense: 'live-expense',
    odometer_entry: 'live-odometer',
    insurance_policy: 'live-policy',
    insurance_claim: 'live-claim',
  };
}

async function orphanCount(): Promise<number> {
  const res = await ctx.authed('GET', '/api/v1/photos/orphans');
  expect(res.status).toBe(200);
  return (await json<DataEnvelope<{ count: number }>>(res)).data.count;
}

describe('GET /api/v1/photos/orphans', () => {
  test('counts only this user’s photos whose entity no longer exists, of every entity type', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Kia', model: 'Niro', year: 2021 });
    seedPhoto('live', ctx.user.id, 'vehicle', vehicleId);
    for (const entityType of Object.keys(PHOTO_ENTITY_TABLES)) {
      seedPhoto(`gone-${entityType}`, ctx.user.id, entityType, `missing-${entityType}`);
    }
    ctx.sqlite.run(
      "INSERT INTO users (id, email, display_name) VALUES ('other', 'o@test.com', 'O')"
    );
    seedPhoto('other-gone', 'other', 'odometer_entry', 'missing-other');

    expect(await orphanCount()).toBe(Object.keys(PHOTO_ENTITY_TABLES).length);
  });

  test('is zero when every photo still has its entity, and an unknown entity type is never counted', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Mazda', model: '3', year: 2019 });
    seedPhoto('live', ctx.user.id, 'vehicle', vehicleId);
    seedPhoto('unknown', ctx.user.id, 'not_an_entity', 'whatever');

    expect(await orphanCount()).toBe(0);
  });

  test('a photo becomes an orphan once its vehicle row is gone', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Honda', model: 'Fit', year: 2018 });
    seedPhoto('cover', ctx.user.id, 'vehicle', vehicleId);
    ctx.sqlite.run('PRAGMA foreign_keys = OFF');
    ctx.sqlite.run('DELETE FROM vehicles WHERE id = ?', [vehicleId]);
    ctx.sqlite.run('PRAGMA foreign_keys = ON');

    expect(await orphanCount()).toBe(1);
  });

  test('401 without a session', async () => {
    expect((await ctx.anon('GET', '/api/v1/photos/orphans')).status).toBe(401);
  });

  test('checks every photo entity type the storage categories know about', () => {
    expect(Object.keys(PHOTO_ENTITY_TABLES).sort()).toEqual(Object.keys(ENTITY_TO_CATEGORY).sort());
  });
});

describe('DELETE /api/v1/photos/orphans', () => {
  async function storeFile(photoId: string): Promise<string> {
    if (!storage) throw new Error('storage not installed');
    const ref = await storage.provider.upload({
      buffer: Buffer.from('jpeg'),
      fileName: `${photoId}.jpg`,
      mimeType: 'image/jpeg',
      entityType: 'odometer_entry',
      entityId: 'x',
      pathHint: 'Odometer',
    });
    ctx.sqlite.run(
      `INSERT INTO photo_refs (id, photo_id, provider_id, storage_ref, status)
       VALUES (?, ?, ?, ?, 'active')`,
      [`ref-${photoId}`, photoId, FAKE_PROVIDER_ID, ref.externalId]
    );
    return ref.externalId;
  }

  test('removes the orphaned rows and their provider files, and leaves every other photo alone', async () => {
    storage = installFakePhotoStorage(ctx);
    const vehicleId = await seedVehicle(ctx, { make: 'Kia', model: 'Niro', year: 2021 });
    seedPhoto('live', ctx.user.id, 'vehicle', vehicleId);
    const liveKey = await storeFile('live');
    seedPhoto('gone', ctx.user.id, 'odometer_entry', 'missing-entry');
    const goneKey = await storeFile('gone');
    ctx.sqlite.run(
      "INSERT INTO users (id, email, display_name) VALUES ('other', 'o@test.com', 'O')"
    );
    seedPhoto('other-gone', 'other', 'odometer_entry', 'missing-other');

    const res = await ctx.authed('DELETE', '/api/v1/photos/orphans');
    expect(res.status).toBe(200);
    expect((await json<DataEnvelope<{ removed: number }>>(res)).data.removed).toBe(1);

    const ids = (
      ctx.sqlite.query('SELECT id FROM photos ORDER BY id').all() as { id: string }[]
    ).map((r) => r.id);
    expect(ids).toEqual(['live', 'other-gone']);
    expect(ctx.sqlite.query("SELECT id FROM photo_refs WHERE photo_id = 'gone'").all()).toEqual([]);
    expect(
      await storage.provider.getExternalUrl({ providerType: 'fake', externalId: goneKey })
    ).toBeNull();
    expect(
      await storage.provider.getExternalUrl({ providerType: 'fake', externalId: liveKey })
    ).not.toBeNull();
    expect(await orphanCount()).toBe(0);
  });

  test('keeps a live photo of every entity type and removes one orphan of each', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Ford', model: 'Focus', year: 2017 });
    const live = seedLiveEntities(vehicleId);
    for (const entityType of Object.keys(PHOTO_ENTITY_TABLES)) {
      seedPhoto(`live-${entityType}`, ctx.user.id, entityType, live[entityType]);
      seedPhoto(`gone-${entityType}`, ctx.user.id, entityType, `missing-${entityType}`);
    }

    const res = await ctx.authed('DELETE', '/api/v1/photos/orphans');
    expect((await json<DataEnvelope<{ removed: number }>>(res)).data.removed).toBe(
      Object.keys(PHOTO_ENTITY_TABLES).length
    );
    const ids = (
      ctx.sqlite.query('SELECT id FROM photos ORDER BY id').all() as { id: string }[]
    ).map((r) => r.id);
    expect(ids).toEqual(
      Object.keys(PHOTO_ENTITY_TABLES)
        .map((t) => `live-${t}`)
        .sort()
    );
  });

  test('removes nothing when there are no orphans', async () => {
    const res = await ctx.authed('DELETE', '/api/v1/photos/orphans');
    expect(res.status).toBe(200);
    expect((await json<DataEnvelope<{ removed: number }>>(res)).data.removed).toBe(0);
  });

  test('401 without a session', async () => {
    expect((await ctx.anon('DELETE', '/api/v1/photos/orphans')).status).toBe(401);
  });
});
