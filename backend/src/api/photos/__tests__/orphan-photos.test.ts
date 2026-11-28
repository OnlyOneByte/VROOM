import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  createTestApp,
  type DataEnvelope,
  json,
  SETUP_TIMEOUT_MS,
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
}, SETUP_TIMEOUT_MS);
let storage: FakePhotoStorage | undefined;

afterEach(() => {
  storage?.restore();
  storage = undefined;
  ctx.close();
});

async function seedPhoto(
  id: string,
  userId: string,
  entityType: string,
  entityId: string
): Promise<void> {
  await ctx.sql.run(
    `INSERT INTO photos (id, user_id, entity_type, entity_id, file_name, mime_type, file_size)
     VALUES (?, ?, ?, ?, ?, 'image/jpeg', 1024)`,
    [id, userId, entityType, entityId, `${id}.jpg`]
  );
}

async function seedLiveEntities(vehicleId: string): Promise<Record<string, string>> {
  const userId = ctx.user.id;
  await ctx.sql.run(
    "INSERT INTO expenses (id, vehicle_id, user_id, category, date, expense_amount) VALUES ('live-expense', ?, ?, 'fuel', 0, 100)",
    [vehicleId, userId]
  );
  await ctx.sql.run(
    "INSERT INTO odometer_entries (id, vehicle_id, user_id, odometer, recorded_at) VALUES ('live-odometer', ?, ?, 1000, 0)",
    [vehicleId, userId]
  );
  await ctx.sql.run(
    "INSERT INTO insurance_policies (id, user_id, company) VALUES ('live-policy', ?, 'Acme')",
    [userId]
  );
  await ctx.sql.run(
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
    await seedPhoto('live', ctx.user.id, 'vehicle', vehicleId);
    for (const entityType of Object.keys(PHOTO_ENTITY_TABLES)) {
      await seedPhoto(`gone-${entityType}`, ctx.user.id, entityType, `missing-${entityType}`);
    }
    await ctx.sql.run(
      "INSERT INTO users (id, email, display_name) VALUES ('other', 'o@test.com', 'O')"
    );
    await seedPhoto('other-gone', 'other', 'odometer_entry', 'missing-other');

    expect(await orphanCount()).toBe(Object.keys(PHOTO_ENTITY_TABLES).length);
  });

  test('is zero when every photo still has its entity, and an unknown entity type is never counted', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Mazda', model: '3', year: 2019 });
    await seedPhoto('live', ctx.user.id, 'vehicle', vehicleId);
    await seedPhoto('unknown', ctx.user.id, 'not_an_entity', 'whatever');

    expect(await orphanCount()).toBe(0);
  });

  test('a photo becomes an orphan once its vehicle row is gone', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Honda', model: 'Fit', year: 2018 });
    await seedPhoto('cover', ctx.user.id, 'vehicle', vehicleId);
    await ctx.sql.run('PRAGMA foreign_keys = OFF');
    await ctx.sql.run('DELETE FROM vehicles WHERE id = ?', [vehicleId]);
    await ctx.sql.run('PRAGMA foreign_keys = ON');

    expect(await orphanCount()).toBe(1);
  });

  test('401 without a session', async () => {
    expect((await ctx.anon('GET', '/api/v1/photos/orphans')).status).toBe(401);
  });

  test('checks every photo entity type the storage categories know about', () => {
    expect(Object.keys(PHOTO_ENTITY_TABLES).sort()).toEqual(Object.keys(ENTITY_TO_CATEGORY).sort());
  });
});

interface Removal {
  removed: number;
  failed: number;
}

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
    await ctx.sql.run(
      `INSERT INTO photo_refs (id, photo_id, provider_id, storage_ref, status)
       VALUES (?, ?, ?, ?, 'active')`,
      [`ref-${photoId}`, photoId, FAKE_PROVIDER_ID, ref.externalId]
    );
    return ref.externalId;
  }

  test('removes the orphaned rows and their provider files, and leaves every other photo alone', async () => {
    storage = await installFakePhotoStorage(ctx);
    const vehicleId = await seedVehicle(ctx, { make: 'Kia', model: 'Niro', year: 2021 });
    await seedPhoto('live', ctx.user.id, 'vehicle', vehicleId);
    const liveKey = await storeFile('live');
    await seedPhoto('gone', ctx.user.id, 'odometer_entry', 'missing-entry');
    const goneKey = await storeFile('gone');
    await ctx.sql.run(
      "INSERT INTO users (id, email, display_name) VALUES ('other', 'o@test.com', 'O')"
    );
    await seedPhoto('other-gone', 'other', 'odometer_entry', 'missing-other');

    const res = await ctx.authed('DELETE', '/api/v1/photos/orphans');
    expect(res.status).toBe(200);
    expect((await json<DataEnvelope<Removal>>(res)).data).toEqual({ removed: 1, failed: 0 });

    const ids = ((await ctx.sql.all('SELECT id FROM photos ORDER BY id')) as { id: string }[]).map(
      (r) => r.id
    );
    expect(ids).toEqual(['live', 'other-gone']);
    expect(await ctx.sql.all("SELECT id FROM photo_refs WHERE photo_id = 'gone'")).toEqual([]);
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
    const live = await seedLiveEntities(vehicleId);
    for (const entityType of Object.keys(PHOTO_ENTITY_TABLES)) {
      await seedPhoto(`live-${entityType}`, ctx.user.id, entityType, live[entityType]);
      await seedPhoto(`gone-${entityType}`, ctx.user.id, entityType, `missing-${entityType}`);
    }

    const res = await ctx.authed('DELETE', '/api/v1/photos/orphans');
    expect((await json<DataEnvelope<Removal>>(res)).data.removed).toBe(
      Object.keys(PHOTO_ENTITY_TABLES).length
    );
    const ids = ((await ctx.sql.all('SELECT id FROM photos ORDER BY id')) as { id: string }[]).map(
      (r) => r.id
    );
    expect(ids).toEqual(
      Object.keys(PHOTO_ENTITY_TABLES)
        .map((t) => `live-${t}`)
        .sort()
    );
  });

  test('keeps a photo whose provider file could not be deleted, so the user can retry', async () => {
    storage = await installFakePhotoStorage(ctx);
    await seedPhoto('stuck', ctx.user.id, 'odometer_entry', 'missing-a');
    const stuckKey = await storeFile('stuck');
    await seedPhoto('gone', ctx.user.id, 'odometer_entry', 'missing-b');
    await storeFile('gone');
    const provider = storage.provider;
    const deleteFile = provider.delete.bind(provider);
    provider.delete = (ref) =>
      ref.externalId === stuckKey ? Promise.reject(new Error('provider down')) : deleteFile(ref);

    const res = await ctx.authed('DELETE', '/api/v1/photos/orphans');
    expect((await json<DataEnvelope<Removal>>(res)).data).toEqual({ removed: 1, failed: 1 });

    expect(await ctx.sql.all('SELECT id FROM photos')).toEqual([{ id: 'stuck' }]);
    expect(await ctx.sql.all('SELECT id FROM photo_refs')).toEqual([{ id: 'ref-stuck' }]);
    expect(
      await provider.getExternalUrl({ providerType: 'fake', externalId: stuckKey })
    ).not.toBeNull();
    expect(await orphanCount()).toBe(1);
  });

  test('removes nothing when there are no orphans', async () => {
    const res = await ctx.authed('DELETE', '/api/v1/photos/orphans');
    expect(res.status).toBe(200);
    expect((await json<DataEnvelope<Removal>>(res)).data).toEqual({ removed: 0, failed: 0 });
  });

  test('401 without a session', async () => {
    expect((await ctx.anon('DELETE', '/api/v1/photos/orphans')).status).toBe(401);
  });
});
