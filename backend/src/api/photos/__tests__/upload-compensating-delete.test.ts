import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { createTestApp, type TestApp } from '../../../test-helpers/http-client';
import { logger } from '../../../utils/logger';
import type { StorageRef } from '../../providers/domains/storage/storage-provider';
import { photoRefRepository } from '../photo-ref-repository';
import { uploadPhotoForEntity } from '../photo-service';
import { type FakePhotoStorage, installFakePhotoStorage } from './fake-photo-storage';

let ctx: TestApp;
let storage: FakePhotoStorage;

beforeEach(async () => {
  ctx = await createTestApp();
  ctx.sqlite.run(
    `INSERT INTO vehicles (id, user_id, make, model, year) VALUES ('veh-1', ?, 'Toyota', 'Camry', 2022)`,
    [ctx.user.id]
  );
  storage = installFakePhotoStorage(ctx);
});

afterEach(() => {
  storage.restore();
  ctx.close();
});

function jpeg(): File {
  return new File([new Uint8Array([1, 2, 3])], 'receipt.jpg', { type: 'image/jpeg' });
}

function photoRowCount(): number {
  return (ctx.sqlite.query('SELECT COUNT(*) AS n FROM photos').get() as { n: number }).n;
}

describe('upload compensates when the DB write fails after the provider upload', () => {
  test('a failed photo_refs insert removes the photo row and the uploaded object, then rethrows', async () => {
    const dbError = new Error('disk I/O error');
    const uploadSpy = spyOn(storage.provider, 'upload');
    const refSpy = spyOn(photoRefRepository, 'create').mockRejectedValueOnce(dbError);

    await expect(uploadPhotoForEntity('vehicle', 'veh-1', ctx.user.id, jpeg())).rejects.toBe(
      dbError
    );

    const uploaded = (await uploadSpy.mock.results[0].value) as StorageRef;
    expect(await storage.provider.getExternalUrl(uploaded)).toBeNull();
    expect(photoRowCount()).toBe(0);

    refSpy.mockRestore();
    uploadSpy.mockRestore();
  });

  test('a failed compensating delete is logged and the original DB error still reaches the caller', async () => {
    const dbError = new Error('disk I/O error');
    const refSpy = spyOn(photoRefRepository, 'create').mockRejectedValueOnce(dbError);
    const deleteSpy = spyOn(storage.provider, 'delete').mockRejectedValueOnce(
      new Error('network down')
    );
    const warnSpy = spyOn(logger, 'warn');

    await expect(uploadPhotoForEntity('vehicle', 'veh-1', ctx.user.id, jpeg())).rejects.toBe(
      dbError
    );

    expect(deleteSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(
      'Failed to clean up orphaned upload after a DB write error',
      expect.objectContaining({ error: 'network down' })
    );

    warnSpy.mockRestore();
    deleteSpy.mockRestore();
    refSpy.mockRestore();
  });
});
