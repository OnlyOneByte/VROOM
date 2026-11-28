import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createTestApp, SETUP_TIMEOUT_MS, type TestApp } from '../../../test-helpers/http-client';
import { seedVehicle } from '../../../test-helpers/seed';

let ctx: TestApp;

beforeEach(async () => {
  ctx = await createTestApp();
}, SETUP_TIMEOUT_MS);
afterEach(() => ctx.close());

async function refRows(): Promise<{ id: string; provider_id: string }[]> {
  return (await ctx.sql.all('SELECT id, provider_id FROM photo_refs ORDER BY id')) as {
    id: string;
    provider_id: string;
  }[];
}

async function seedProvider(id: string, ownerId: string): Promise<string> {
  await ctx.sql.run(
    `INSERT INTO user_providers (id, user_id, domain, provider_type, display_name, credentials, status)
     VALUES (?, ?, 'storage', 'google_drive', ?, 'ciphertext', 'active')`,
    [id, ownerId, id]
  );
  return id;
}

async function seedPhotoWithRef(photoId: string, vehicleId: string, refId: string, providerId: string) {
  await ctx.sql.run(
    `INSERT INTO photos (id, user_id, entity_type, entity_id, file_name, mime_type, file_size, is_cover, sort_order, created_at)
     VALUES (?, ?, 'vehicle', ?, 'photo.jpg', 'image/jpeg', 1024, FALSE, 0, 0)`,
    [photoId, ctx.user.id, vehicleId]
  );
  await ctx.sql.run(
    `INSERT INTO photo_refs (id, photo_id, provider_id, storage_ref, status, retry_count, created_at)
     VALUES (?, ?, ?, 'remote/photo.jpg', 'pending', 0, 0)`,
    [refId, photoId, providerId]
  );
}

describe('restore scopes the photo_ref provider probe to the importer', () => {
  test("a ref naming another user's provider is skipped; a ref naming the importer's own survives", async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Toyota', model: 'Camry', year: 2022 });

    await ctx.sql.run('INSERT INTO users (id, email, display_name) VALUES (?, ?, ?)', [
      'other-user',
      'other@test.com',
      'Other',
    ]);
    const ownProvider = await seedProvider('own-provider', ctx.user.id);
    const foreignProvider = await seedProvider('foreign-provider', 'other-user');

    await seedPhotoWithRef('photo-own', vehicleId, 'ref-own', ownProvider);
    await seedPhotoWithRef('photo-foreign', vehicleId, 'ref-foreign', foreignProvider);
    expect(await refRows()).toHaveLength(2);

    const { backupService } = await import('../backup');
    const { restoreService } = await import('../restore');

    const zip = await backupService.exportAsZip(ctx.user.id);
    const result = await restoreService.restoreFromBackup(ctx.user.id, zip, 'replace');
    expect(result.success, JSON.stringify(result)).toBe(true);

    expect((await refRows()).map((r) => r.id)).toEqual(['ref-own']);
    expect((await refRows())[0].provider_id).toBe(ownProvider);
  });
});
