import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import { AppError, NotFoundError } from '../../../errors';
import { createTestApp, type TestApp } from '../../../test-helpers/http-client';
import {
  ALLOWED_MIME_TYPES,
  deletePhotoForEntity,
  MAX_FILE_SIZE,
  setCoverPhotoForEntity,
  uploadPhotoForEntity,
} from '../photo-service';
import { type FakePhotoStorage, installFakePhotoStorage } from './fake-photo-storage';

const VEHICLES = ['veh-1', 'veh-2'];

let ctx: TestApp;
let storage: FakePhotoStorage;

beforeEach(async () => {
  ctx = await createTestApp();
  for (const id of VEHICLES) {
    ctx.sqlite.run('INSERT INTO vehicles (id, user_id, make, model, year) VALUES (?, ?, ?, ?, ?)', [
      id,
      ctx.user.id,
      'Toyota',
      'Camry',
      2022,
    ]);
  }
  storage = installFakePhotoStorage(ctx);
});

afterEach(() => {
  storage.restore();
  ctx.close();
});

let uploadCounter = 0;

function jpeg(): File {
  return new File([new Uint8Array([1, 2, 3])], `photo-${++uploadCounter}.jpg`, {
    type: 'image/jpeg',
  });
}

function photoCount(vehicleId: string): number {
  return (
    ctx.sqlite
      .query("SELECT COUNT(*) AS n FROM photos WHERE entity_type = 'vehicle' AND entity_id = ?")
      .get(vehicleId) as { n: number }
  ).n;
}

function dbState(vehicleId: string): { id: string; isCover: boolean }[] {
  const rows = ctx.sqlite
    .query(
      "SELECT id, is_cover FROM photos WHERE entity_type = 'vehicle' AND entity_id = ? ORDER BY id"
    )
    .all(vehicleId) as { id: string; is_cover: number }[];
  return rows.map((r) => ({ id: r.id, isCover: r.is_cover === 1 }));
}

describe('upload validation (before any storage work)', () => {
  test('any MIME type outside the allowlist is rejected with 400 and writes nothing', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ maxLength: 40 }).filter((t) => !ALLOWED_MIME_TYPES.includes(t)),
        async (type) => {
          const file = {
            name: 'x.bin',
            type,
            size: 10,
            arrayBuffer: async () => new ArrayBuffer(0),
          };
          await expect(
            uploadPhotoForEntity('vehicle', 'veh-1', ctx.user.id, file as unknown as File)
          ).rejects.toMatchObject({ statusCode: 400 });
        }
      ),
      { numRuns: 100 }
    );
    expect(photoCount('veh-1')).toBe(0);
  });

  test('any size above MAX_FILE_SIZE is rejected with 413 and writes nothing', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: MAX_FILE_SIZE + 1, max: MAX_FILE_SIZE * 4 }),
        async (size) => {
          const file = {
            name: 'big.jpg',
            type: 'image/jpeg',
            size,
            arrayBuffer: async () => new ArrayBuffer(0),
          };
          await expect(
            uploadPhotoForEntity('vehicle', 'veh-1', ctx.user.id, file as unknown as File)
          ).rejects.toMatchObject({ statusCode: 413 });
        }
      ),
      { numRuns: 100 }
    );
    expect(photoCount('veh-1')).toBe(0);
  });

  test('an allowed type at or under the size limit is accepted', async () => {
    const file = new File([new Uint8Array([9])], 'ok.png', { type: 'image/png' });
    const photo = await uploadPhotoForEntity('vehicle', 'veh-1', ctx.user.id, file);
    expect(photo.mimeType).toBe('image/png');
    expect(photoCount('veh-1')).toBe(1);
  });

  test('the allowlist is exactly JPEG, PNG, WebP, and PDF; the size cap is 10 MiB', () => {
    expect(new Set(ALLOWED_MIME_TYPES)).toEqual(
      new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
    );
    expect(MAX_FILE_SIZE).toBe(10_485_760);
  });
});

interface ModelPhoto {
  id: string;
  isCover: boolean;
  seq: number;
}

type Op =
  | { type: 'upload'; vehicle: number }
  | { type: 'setCover'; vehicle: number; pick: number }
  | { type: 'delete'; vehicle: number; pick: number };

const opArb: fc.Arbitrary<Op> = fc.oneof(
  fc.record({ type: fc.constant('upload' as const), vehicle: fc.nat({ max: 1 }) }),
  fc.record({
    type: fc.constant('setCover' as const),
    vehicle: fc.nat({ max: 1 }),
    pick: fc.nat({ max: 9 }),
  }),
  fc.record({
    type: fc.constant('delete' as const),
    vehicle: fc.nat({ max: 1 }),
    pick: fc.nat({ max: 9 }),
  })
);

type Model = Map<string, ModelPhoto[]>;

async function uploadOp(photos: ModelPhoto[], vehicleId: string, seq: number): Promise<void> {
  const photo = await uploadPhotoForEntity('vehicle', vehicleId, ctx.user.id, jpeg());
  photos.push({ id: photo.id, isCover: photos.length === 0, seq });
  // created_at has 1s resolution, so pin the creation order for deterministic promotion.
  ctx.sqlite.run('UPDATE photos SET created_at = ? WHERE id = ?', [seq, photo.id]);
}

async function setCoverOp(photos: ModelPhoto[], vehicleId: string, target: ModelPhoto) {
  await setCoverPhotoForEntity('vehicle', vehicleId, target.id, ctx.user.id);
  for (const p of photos) p.isCover = p.id === target.id;
}

async function deleteOp(photos: ModelPhoto[], vehicleId: string, target: ModelPhoto) {
  await deletePhotoForEntity('vehicle', vehicleId, target.id, ctx.user.id);
  photos.splice(photos.indexOf(target), 1);
  if (target.isCover && photos.length > 0) {
    const oldest = photos.reduce((a, b) => (a.seq <= b.seq ? a : b));
    oldest.isCover = true;
  }
}

async function applyOp(model: Model, op: Op, seq: number): Promise<number> {
  const vehicleId = VEHICLES[op.vehicle];
  const photos = model.get(vehicleId) ?? [];

  if (op.type === 'upload') {
    await uploadOp(photos, vehicleId, seq);
    return seq + 1;
  }
  if (photos.length > 0) {
    const target = photos[op.pick % photos.length];
    if (op.type === 'setCover') {
      await setCoverOp(photos, vehicleId, target);
    } else {
      await deleteOp(photos, vehicleId, target);
    }
  }
  return seq;
}

function expectDbMatchesModel(model: Model): void {
  for (const vehicleId of VEHICLES) {
    const expected = (model.get(vehicleId) ?? []).map((p) => ({ id: p.id, isCover: p.isCover }));
    const actual = dbState(vehicleId);
    expect(actual.sort(byId)).toEqual(expected.sort(byId));
    expect(actual.filter((p) => p.isCover).length).toBeLessThanOrEqual(1);
  }
}

describe('cover rules through the real service', () => {
  test('after every upload, cover change, or delete, the database matches the cover model on both vehicles', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(opArb, { minLength: 1, maxLength: 20 }), async (ops) => {
        ctx.sqlite.run('DELETE FROM photos');
        const model: Model = new Map(VEHICLES.map((v) => [v, []]));
        let seq = 0;

        for (const op of ops) {
          seq = await applyOp(model, op, seq);
          expectDbMatchesModel(model);
        }
      }),
      { numRuns: 40 }
    );
  });

  test('setCoverPhotoForEntity rejects a photo that belongs to another vehicle', async () => {
    const other = await uploadPhotoForEntity('vehicle', 'veh-2', ctx.user.id, jpeg());
    await uploadPhotoForEntity('vehicle', 'veh-1', ctx.user.id, jpeg());

    await expect(
      setCoverPhotoForEntity('vehicle', 'veh-1', other.id, ctx.user.id)
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(dbState('veh-2').find((p) => p.id === other.id)?.isCover).toBe(true);
  });

  test('deleting a non-cover photo leaves the cover unchanged', async () => {
    await uploadPhotoForEntity('vehicle', 'veh-1', ctx.user.id, jpeg());
    const second = await uploadPhotoForEntity('vehicle', 'veh-1', ctx.user.id, jpeg());
    const cover = dbState('veh-1').find((p) => p.isCover);

    await deletePhotoForEntity('vehicle', 'veh-1', second.id, ctx.user.id);

    expect(dbState('veh-1').find((p) => p.isCover)?.id).toBe(cover?.id);
  });

  test('a photo cannot be deleted through another entity type that shares its entity id', async () => {
    const photo = await uploadPhotoForEntity('vehicle', 'veh-1', ctx.user.id, jpeg());
    await expect(
      deletePhotoForEntity('expense', 'veh-1', photo.id, ctx.user.id)
    ).rejects.toBeInstanceOf(AppError);
    expect(dbState('veh-1').map((p) => p.id)).toContain(photo.id);
  });
});

function byId(a: { id: string }, b: { id: string }): number {
  return a.id.localeCompare(b.id);
}
