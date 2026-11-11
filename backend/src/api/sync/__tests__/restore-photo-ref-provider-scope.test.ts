// A restored photo_ref may only name a storage provider the importer owns. The sync worker resolves
// providers by id alone, so a foreign provider would receive the importer's photos.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createTestApp, type TestApp } from '../../../test-helpers/http-client';
import { seedVehicle } from '../../../test-helpers/seed';

let ctx: TestApp; // the importing user

beforeEach(async () => {
  ctx = await createTestApp();
});
afterEach(() => ctx.close());

function refRows(): { id: string; provider_id: string }[] {
  return ctx.sqlite.query('SELECT id, provider_id FROM photo_refs ORDER BY id').all() as {
    id: string;
    provider_id: string;
  }[];
}

function seedProvider(id: string, ownerId: string): string {
  ctx.sqlite.run(
    `INSERT INTO user_providers (id, user_id, domain, provider_type, display_name, credentials, status)
     VALUES (?, ?, 'storage', 'google_drive', ?, 'ciphertext', 'active')`,
    [id, ownerId, id]
  );
  return id;
}

function seedPhotoWithRef(photoId: string, vehicleId: string, refId: string, providerId: string) {
  ctx.sqlite.run(
    `INSERT INTO photos (id, user_id, entity_type, entity_id, file_name, mime_type, file_size, is_cover, sort_order, created_at)
     VALUES (?, ?, 'vehicle', ?, 'photo.jpg', 'image/jpeg', 1024, 0, 0, 0)`,
    [photoId, ctx.user.id, vehicleId]
  );
  ctx.sqlite.run(
    `INSERT INTO photo_refs (id, photo_id, provider_id, storage_ref, status, retry_count, created_at)
     VALUES (?, ?, ?, 'remote/photo.jpg', 'pending', 0, 0)`,
    [refId, photoId, providerId]
  );
}

describe('restore scopes the photo_ref provider probe to the importer', () => {
  test("a ref naming another user's provider is skipped; a ref naming the importer's own survives", async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Toyota', model: 'Camry', year: 2022 });

    ctx.sqlite.run('INSERT INTO users (id, email, display_name) VALUES (?, ?, ?)', [
      'other-user',
      'other@test.com',
      'Other',
    ]);
    const ownProvider = seedProvider('own-provider', ctx.user.id);
    const foreignProvider = seedProvider('foreign-provider', 'other-user');

    // Two refs on the importer's own photos; one names a provider the importer does not own.
    seedPhotoWithRef('photo-own', vehicleId, 'ref-own', ownProvider);
    seedPhotoWithRef('photo-foreign', vehicleId, 'ref-foreign', foreignProvider);
    expect(refRows()).toHaveLength(2);

    const { backupService } = await import('../backup');
    const { restoreService } = await import('../restore');

    const zip = await backupService.exportAsZip(ctx.user.id);
    const result = await restoreService.restoreFromBackup(ctx.user.id, zip, 'replace');
    expect(result.success, JSON.stringify(result)).toBe(true);

    // Both directions: without the ownership check the foreign ref survives; an over-narrow probe drops the own ref.
    expect(refRows().map((r) => r.id)).toEqual(['ref-own']);
    expect(refRows()[0].provider_id).toBe(ownProvider);
  });
});
