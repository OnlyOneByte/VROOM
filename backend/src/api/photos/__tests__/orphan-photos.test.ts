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

let ctx: TestApp;

beforeEach(async () => {
  ctx = await createTestApp();
});
afterEach(() => ctx.close());

function seedPhoto(id: string, userId: string, entityType: string, entityId: string): void {
  ctx.sqlite.run(
    `INSERT INTO photos (id, user_id, entity_type, entity_id, file_name, mime_type, file_size)
     VALUES (?, ?, ?, ?, ?, 'image/jpeg', 1024)`,
    [id, userId, entityType, entityId, `${id}.jpg`]
  );
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
