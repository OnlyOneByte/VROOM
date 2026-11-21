import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createTestApp, type TestApp } from '../../../test-helpers/http-client';
import { createInvitee, type Invitee } from '../../../test-helpers/invitee';
import {
  deletePhotoForEntity,
  getPhotoThumbnailForEntity,
  listPhotosForEntity,
  uploadPhotoForEntity,
} from '../photo-service';
import {
  FAKE_PROVIDER_ID,
  type FakePhotoStorage,
  installFakePhotoStorage,
} from './fake-photo-storage';

let ctx: TestApp;
let storage: FakePhotoStorage | null;
let editor: Invitee;

const receipt = (): File =>
  new File([new Uint8Array([137, 80, 78, 71])], 'receipt.png', { type: 'image/png' });

beforeEach(async () => {
  ctx = await createTestApp();
  storage = null;
  ctx.sqlite.run(
    `INSERT INTO vehicles (id, user_id, make, model, year) VALUES ('veh-shared', ?, 'Volvo', 'XC40', 2021)`,
    [ctx.user.id]
  );
  ctx.sqlite.run(
    `INSERT INTO expenses (id, vehicle_id, user_id, category, date, expense_amount)
     VALUES ('exp-shared', 'veh-shared', ?, 'fuel', 1700000000, 2500)`,
    [ctx.user.id]
  );
  editor = await createInvitee(ctx, 'editor');
  await editor.acceptShare('veh-shared', 'editor');
});

afterEach(() => {
  storage?.restore();
  ctx.close();
});

describe("an editor's photo on a shared vehicle belongs to the vehicle owner", () => {
  test("the upload is owned by the owner and stored in the owner's provider", async () => {
    storage = installFakePhotoStorage(ctx);
    const photo = await uploadPhotoForEntity('expense', 'exp-shared', editor.id, receipt());

    expect(photo.userId).toBe(ctx.user.id);
    const ref = ctx.sqlite
      .query('SELECT provider_id, status FROM photo_refs WHERE photo_id = ?')
      .get(photo.id);
    expect(ref).toEqual({ provider_id: FAKE_PROVIDER_ID, status: 'active' });
  });

  test('both the owner and the editor can list and open it', async () => {
    storage = installFakePhotoStorage(ctx);
    const photo = await uploadPhotoForEntity('expense', 'exp-shared', editor.id, receipt());

    for (const viewer of [ctx.user.id, editor.id]) {
      const listed = await listPhotosForEntity('expense', 'exp-shared', viewer, {
        limit: 10,
        offset: 0,
      });
      expect(listed.data.map((p) => p.id)).toEqual([photo.id]);
      const thumb = await getPhotoThumbnailForEntity('expense', 'exp-shared', photo.id, viewer);
      expect(thumb.mimeType).toBe('image/png');
    }
  });

  test("the editor deleting it removes the file from the owner's storage", async () => {
    storage = installFakePhotoStorage(ctx);
    const photo = await uploadPhotoForEntity('expense', 'exp-shared', editor.id, receipt());
    const { storage_ref } = ctx.sqlite
      .query('SELECT storage_ref FROM photo_refs WHERE photo_id = ?')
      .get(photo.id) as { storage_ref: string };

    await deletePhotoForEntity('expense', 'exp-shared', photo.id, editor.id);

    expect(ctx.sqlite.query('SELECT id FROM photos').all()).toEqual([]);
    await expect(
      storage.provider.download({ providerType: 'fake', externalId: storage_ref })
    ).rejects.toThrow();
  });

  test('an owner without photo storage gets a clear error, not a silent fallback', async () => {
    await expect(
      uploadPhotoForEntity('expense', 'exp-shared', editor.id, receipt())
    ).rejects.toThrow("This vehicle's owner hasn't set up photo storage");
    expect(ctx.sqlite.query('SELECT id FROM photos').all()).toEqual([]);
  });
});
