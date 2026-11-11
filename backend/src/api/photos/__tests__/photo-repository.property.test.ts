/**
 * Property tests over an in-memory model of PhotoRepository's cover rules. After any sequence of
 * create, setCover, and delete on an entity, at most one photo is the cover, and an entity's photo
 * set never overlaps another entity's.
 */

import { describe, expect, test } from 'bun:test';
import fc from 'fast-check';

interface RefPhoto {
  id: string;
  isCover: boolean;
  createdAt: number;
}

class ReferencePhotoModel {
  photos: RefPhoto[] = [];

  create(id: string, createdAt: number): void {
    const isFirst = this.photos.length === 0;
    this.photos.push({ id, isCover: isFirst, createdAt });
  }

  setCover(photoId: string): void {
    const target = this.photos.find((p) => p.id === photoId);
    if (!target) return;
    for (const p of this.photos) {
      p.isCover = false;
    }
    target.isCover = true;
  }

  delete(photoId: string): void {
    const idx = this.photos.findIndex((p) => p.id === photoId);
    if (idx === -1) return;
    const wasCover = this.photos[idx].isCover;
    this.photos.splice(idx, 1);

    if (wasCover && this.photos.length > 0) {
      const oldest = this.photos.reduce((a, b) => (a.createdAt <= b.createdAt ? a : b));
      oldest.isCover = true;
    }
  }
}

type Op =
  | { type: 'create'; createdAt: number }
  | { type: 'setCover'; photoIndex: number }
  | { type: 'delete'; photoIndex: number };

const timestampArb = fc.integer({ min: 1672531200000, max: 1767139200000 });

const opsArb = fc.array(
  fc.oneof(
    timestampArb.map((ts): Op => ({ type: 'create', createdAt: ts })),
    fc.nat({ max: 19 }).map((idx): Op => ({ type: 'setCover', photoIndex: idx })),
    fc.nat({ max: 19 }).map((idx): Op => ({ type: 'delete', photoIndex: idx }))
  ),
  { minLength: 1, maxLength: 40 }
);

/** Applies one operation; indices resolve against the photos that currently exist. */
function applyOp(model: ReferencePhotoModel, op: Op, nextId: number): number {
  if (op.type === 'create') {
    model.create(`photo-${nextId}`, op.createdAt);
    return nextId + 1;
  }
  if (model.photos.length === 0) return nextId;
  const idx = op.photoIndex % model.photos.length;
  const targetId = model.photos[idx].id;
  if (op.type === 'setCover') {
    model.setCover(targetId);
  } else {
    model.delete(targetId);
  }
  return nextId;
}

function assertCoverInvariant(model: ReferencePhotoModel): void {
  const coverCount = model.photos.filter((p) => p.isCover).length;
  if (model.photos.length === 0) {
    expect(coverCount).toBe(0);
  } else {
    expect(coverCount).toBe(1);
  }
}

describe('single cover invariant', () => {
  test('after any sequence of create/setCover/delete, at most one photo has isCover = true', () => {
    fc.assert(
      fc.property(opsArb, (ops) => {
        const model = new ReferencePhotoModel();
        let nextId = 0;
        for (const op of ops) {
          nextId = applyOp(model, op, nextId);
        }
        assertCoverInvariant(model);
      }),
      { numRuns: 100 }
    );
  });

  test('if entity has photos, exactly one is cover after every operation', () => {
    fc.assert(
      fc.property(opsArb, (ops) => {
        const model = new ReferencePhotoModel();
        let nextId = 0;
        for (const op of ops) {
          nextId = applyOp(model, op, nextId);
          assertCoverInvariant(model);
        }
      }),
      { numRuns: 100 }
    );
  });

  test('first created photo always becomes cover', () => {
    fc.assert(
      fc.property(timestampArb, (ts) => {
        const model = new ReferencePhotoModel();
        model.create('photo-0', ts);
        expect(model.photos[0].isCover).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  test('deleting cover promotes oldest remaining photo', () => {
    fc.assert(
      fc.property(fc.array(timestampArb, { minLength: 2, maxLength: 10 }), (timestamps) => {
        const model = new ReferencePhotoModel();
        for (let i = 0; i < timestamps.length; i++) {
          model.create(`photo-${i}`, timestamps[i]);
        }

        const cover = model.photos.find((p) => p.isCover);
        expect(cover).toBeDefined();
        if (!cover) return;
        model.delete(cover.id);

        assertCoverInvariant(model);

        const newCover = model.photos.find((p) => p.isCover);
        expect(newCover).toBeDefined();
        if (!newCover) return;

        const oldestRemaining = model.photos.reduce((a, b) => (a.createdAt <= b.createdAt ? a : b));
        expect(newCover.id).toBe(oldestRemaining.id);
      }),
      { numRuns: 100 }
    );
  });
});

interface EntityKey {
  entityType: string;
  entityId: string;
}

function entityKeyStr(k: EntityKey): string {
  return `${k.entityType}:${k.entityId}`;
}

class MultiEntityRefModel {
  private entities = new Map<string, RefPhoto[]>();

  private getPhotos(key: EntityKey): RefPhoto[] {
    const k = entityKeyStr(key);
    if (!this.entities.has(k)) {
      this.entities.set(k, []);
    }
    // biome-ignore lint/style/noNonNullAssertion: key is guaranteed to exist after set above
    return this.entities.get(k)!;
  }

  create(key: EntityKey, id: string, createdAt: number): void {
    const photos = this.getPhotos(key);
    const isFirst = photos.length === 0;
    photos.push({ id, isCover: isFirst, createdAt });
  }

  setCover(key: EntityKey, photoId: string): void {
    const photos = this.getPhotos(key);
    const target = photos.find((p) => p.id === photoId);
    if (!target) return;
    for (const p of photos) {
      p.isCover = false;
    }
    target.isCover = true;
  }

  delete(key: EntityKey, photoId: string): void {
    const photos = this.getPhotos(key);
    const idx = photos.findIndex((p) => p.id === photoId);
    if (idx === -1) return;
    const wasCover = photos[idx].isCover;
    photos.splice(idx, 1);

    if (wasCover && photos.length > 0) {
      const oldest = photos.reduce((a, b) => (a.createdAt <= b.createdAt ? a : b));
      oldest.isCover = true;
    }
  }

  findByEntity(key: EntityKey): RefPhoto[] {
    return [...this.getPhotos(key)];
  }

  photoIds(key: EntityKey): Set<string> {
    return new Set(this.getPhotos(key).map((p) => p.id));
  }

  coverPhoto(key: EntityKey): RefPhoto | undefined {
    return this.getPhotos(key).find((p) => p.isCover);
  }
}

const entityTypeArb = fc.constantFrom('vehicle', 'expense', 'trip');
const entityIdArb = fc
  .string({ minLength: 1, maxLength: 8 })
  .map((s) => s.replace(/[^a-zA-Z0-9]/g, 'x') || 'x');

const entityKeyArb: fc.Arbitrary<EntityKey> = fc.record({
  entityType: entityTypeArb,
  entityId: entityIdArb,
});

/** Two entity keys that differ in entityType or entityId. */
const distinctEntityPairArb: fc.Arbitrary<[EntityKey, EntityKey]> = fc
  .tuple(entityKeyArb, entityKeyArb)
  .filter(([a, b]) => a.entityType !== b.entityType || a.entityId !== b.entityId);

type EntityOp =
  | { type: 'create'; createdAt: number }
  | { type: 'setCover'; photoIndex: number }
  | { type: 'delete'; photoIndex: number };

const entityOpsArb = fc.array(
  fc.oneof(
    timestampArb.map((ts): EntityOp => ({ type: 'create', createdAt: ts })),
    fc.nat({ max: 19 }).map((idx): EntityOp => ({ type: 'setCover', photoIndex: idx })),
    fc.nat({ max: 19 }).map((idx): EntityOp => ({ type: 'delete', photoIndex: idx }))
  ),
  { minLength: 1, maxLength: 20 }
);

function applyEntityOp(
  model: MultiEntityRefModel,
  key: EntityKey,
  op: EntityOp,
  nextId: number,
  prefix: string
): number {
  if (op.type === 'create') {
    model.create(key, `${prefix}-${nextId}`, op.createdAt);
    return nextId + 1;
  }
  const photos = model.findByEntity(key);
  if (photos.length === 0) return nextId;
  const idx = op.photoIndex % photos.length;
  const targetId = photos[idx].id;
  if (op.type === 'setCover') {
    model.setCover(key, targetId);
  } else {
    model.delete(key, targetId);
  }
  return nextId;
}

describe('entity isolation', () => {
  test('findByEntity results for two distinct entities never overlap', () => {
    fc.assert(
      fc.property(distinctEntityPairArb, entityOpsArb, entityOpsArb, ([keyA, keyB], opsA, opsB) => {
        const model = new MultiEntityRefModel();
        let nextIdA = 0;
        let nextIdB = 0;

        for (const op of opsA) {
          nextIdA = applyEntityOp(model, keyA, op, nextIdA, 'a');
        }
        for (const op of opsB) {
          nextIdB = applyEntityOp(model, keyB, op, nextIdB, 'b');
        }

        const idsA = model.photoIds(keyA);
        const idsB = model.photoIds(keyB);
        for (const id of idsA) {
          expect(idsB.has(id)).toBe(false);
        }
        for (const id of idsB) {
          expect(idsA.has(id)).toBe(false);
        }
      }),
      { numRuns: 100 }
    );
  });

  test('creating photos on entity A then querying entity B returns empty', () => {
    fc.assert(
      fc.property(
        distinctEntityPairArb,
        fc.array(timestampArb, { minLength: 1, maxLength: 10 }),
        ([keyA, keyB], timestamps) => {
          const model = new MultiEntityRefModel();
          for (let i = 0; i < timestamps.length; i++) {
            model.create(keyA, `photo-${i}`, timestamps[i]);
          }

          const photosB = model.findByEntity(keyB);
          expect(photosB.length).toBe(0);
        }
      ),
      { numRuns: 100 }
    );
  });

  test('setCover on entity A does not affect entity B cover', () => {
    fc.assert(
      fc.property(
        distinctEntityPairArb,
        fc.array(timestampArb, { minLength: 2, maxLength: 6 }),
        fc.array(timestampArb, { minLength: 2, maxLength: 6 }),
        fc.nat(),
        ([keyA, keyB], tsA, tsB, coverIdx) => {
          const model = new MultiEntityRefModel();

          for (let i = 0; i < tsA.length; i++) {
            model.create(keyA, `a-${i}`, tsA[i]);
          }
          for (let i = 0; i < tsB.length; i++) {
            model.create(keyB, `b-${i}`, tsB[i]);
          }

          const coverBBefore = model.coverPhoto(keyB);

          const photosA = model.findByEntity(keyA);
          const targetIdx = coverIdx % photosA.length;
          model.setCover(keyA, photosA[targetIdx].id);

          const coverBAfter = model.coverPhoto(keyB);
          expect(coverBAfter?.id).toBe(coverBBefore?.id);
          expect(coverBAfter?.isCover).toBe(coverBBefore?.isCover);
        }
      ),
      { numRuns: 100 }
    );
  });

  test('deleting photos on entity A does not change entity B photo count or cover', () => {
    fc.assert(
      fc.property(
        distinctEntityPairArb,
        fc.array(timestampArb, { minLength: 2, maxLength: 6 }),
        fc.array(timestampArb, { minLength: 1, maxLength: 6 }),
        fc.nat(),
        ([keyA, keyB], tsA, tsB, deleteIdx) => {
          const model = new MultiEntityRefModel();

          for (let i = 0; i < tsA.length; i++) {
            model.create(keyA, `a-${i}`, tsA[i]);
          }
          for (let i = 0; i < tsB.length; i++) {
            model.create(keyB, `b-${i}`, tsB[i]);
          }

          const photosBBefore = model.findByEntity(keyB);
          const coverBBefore = model.coverPhoto(keyB);

          const photosA = model.findByEntity(keyA);
          const targetIdx = deleteIdx % photosA.length;
          model.delete(keyA, photosA[targetIdx].id);

          const photosBAfter = model.findByEntity(keyB);
          expect(photosBAfter.length).toBe(photosBBefore.length);
          expect(model.coverPhoto(keyB)?.id).toBe(coverBBefore?.id);
        }
      ),
      { numRuns: 100 }
    );
  });

  test('same entityId but different entityType are fully isolated', () => {
    fc.assert(
      fc.property(
        entityIdArb,
        fc.array(timestampArb, { minLength: 1, maxLength: 6 }),
        fc.array(timestampArb, { minLength: 1, maxLength: 6 }),
        entityOpsArb,
        (sharedId, tsVehicle, tsExpense, extraOps) => {
          const keyVehicle: EntityKey = { entityType: 'vehicle', entityId: sharedId };
          const keyExpense: EntityKey = { entityType: 'expense', entityId: sharedId };
          const model = new MultiEntityRefModel();

          for (let i = 0; i < tsVehicle.length; i++) {
            model.create(keyVehicle, `v-${i}`, tsVehicle[i]);
          }
          for (let i = 0; i < tsExpense.length; i++) {
            model.create(keyExpense, `e-${i}`, tsExpense[i]);
          }

          let nextId = 100;
          for (const op of extraOps) {
            nextId = applyEntityOp(model, keyVehicle, op, nextId, 'v-extra');
          }

          const expensePhotos = model.findByEntity(keyExpense);
          const expenseIds = new Set(expensePhotos.map((p) => p.id));
          for (let i = 0; i < tsExpense.length; i++) {
            expect(expenseIds.has(`e-${i}`)).toBe(true);
          }
          expect(expensePhotos.length).toBe(tsExpense.length);

          const vehicleIds = model.photoIds(keyVehicle);
          for (const id of vehicleIds) {
            expect(expenseIds.has(id)).toBe(false);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
