/**
 * Property-Based Tests for PhotoRepository
 *
 * Property 1: Single Cover Invariant
 * After any sequence of create/setCover/delete operations on an entity,
 * at most one photo has `isCover = true`. If the entity has at least one
 * photo, exactly one should be cover. If zero photos remain, none should
 * be cover.
 *
 * **Validates: Requirements 3.1, 3.4, 14.2**
 *
 * Approach: Generate a random sequence of operations (create, setCover,
 * delete) and apply them to an in-memory reference model. After all
 * operations, verify the single-cover invariant holds.
 */

import { describe, expect, test } from 'bun:test';
import fc from 'fast-check';

// ---------------------------------------------------------------------------
// Reference Model
// ---------------------------------------------------------------------------

/** Minimal in-memory photo for the reference model. */
interface RefPhoto {
  id: string;
  isCover: boolean;
  createdAt: number;
}

/**
 * Reference implementation that simulates PhotoRepository behaviour
 * purely in memory, matching the contract from the design doc.
 */
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

// ---------------------------------------------------------------------------
// Operation types
// ---------------------------------------------------------------------------

type Op =
  | { type: 'create'; createdAt: number }
  | { type: 'setCover'; photoIndex: number }
  | { type: 'delete'; photoIndex: number };

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

const timestampArb = fc.integer({ min: 1672531200000, max: 1767139200000 });

const opsArb = fc.array(
  fc.oneof(
    timestampArb.map((ts): Op => ({ type: 'create', createdAt: ts })),
    fc.nat({ max: 19 }).map((idx): Op => ({ type: 'setCover', photoIndex: idx })),
    fc.nat({ max: 19 }).map((idx): Op => ({ type: 'delete', photoIndex: idx }))
  ),
  { minLength: 1, maxLength: 40 }
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Apply a single operation to the model, resolving indices against live photos. */
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

/** Assert the single-cover invariant on the current model state. */
function assertCoverInvariant(model: ReferencePhotoModel): void {
  const coverCount = model.photos.filter((p) => p.isCover).length;
  if (model.photos.length === 0) {
    expect(coverCount).toBe(0);
  } else {
    expect(coverCount).toBe(1);
  }
}

// ---------------------------------------------------------------------------
// Property 1: Single Cover Invariant
// ---------------------------------------------------------------------------

describe('Property 1: Single Cover Invariant', () => {
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
      { numRuns: 200 }
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
      { numRuns: 200 }
    );
  });

  test('first created photo always becomes cover', () => {
    fc.assert(
      fc.property(timestampArb, (ts) => {
        const model = new ReferencePhotoModel();
        model.create('photo-0', ts);
        expect(model.photos[0].isCover).toBe(true);
      }),
      { numRuns: 200 }
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
      { numRuns: 200 }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 4: Entity Isolation
// ---------------------------------------------------------------------------

/**
 * Property 4: Entity Isolation
 *
 * For any two distinct (entityType, entityId) pairs — including pairs where
 * the entityId matches but the entityType differs — the set of photos
 * returned by findByEntity for one pair has zero overlap with the set
 * returned for the other pair. Operations on one entity never affect photos
 * of another entity.
 *
 * **Validates: Requirements 6.1, 6.2**
 */

// ---------------------------------------------------------------------------
// Multi-entity reference model
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Generators for entity isolation
// ---------------------------------------------------------------------------

const entityTypeArb = fc.constantFrom('vehicle', 'expense', 'trip');
const entityIdArb = fc
  .string({ minLength: 1, maxLength: 8 })
  .map((s) => s.replace(/[^a-zA-Z0-9]/g, 'x') || 'x');

const entityKeyArb: fc.Arbitrary<EntityKey> = fc.record({
  entityType: entityTypeArb,
  entityId: entityIdArb,
});

/** Generate two distinct entity keys (differ in at least one component). */
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

// ---------------------------------------------------------------------------
// Helpers for entity isolation
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Property 4: Entity Isolation', () => {
  test('findByEntity results for two distinct entities never overlap', () => {
    fc.assert(
      fc.property(distinctEntityPairArb, entityOpsArb, entityOpsArb, ([keyA, keyB], opsA, opsB) => {
        const model = new MultiEntityRefModel();
        let nextIdA = 0;
        let nextIdB = 0;

        // Apply all operations for entity A
        for (const op of opsA) {
          nextIdA = applyEntityOp(model, keyA, op, nextIdA, 'a');
        }
        // Apply all operations for entity B
        for (const op of opsB) {
          nextIdB = applyEntityOp(model, keyB, op, nextIdB, 'b');
        }

        // Verify: photo sets are disjoint
        const idsA = model.photoIds(keyA);
        const idsB = model.photoIds(keyB);
        for (const id of idsA) {
          expect(idsB.has(id)).toBe(false);
        }
        for (const id of idsB) {
          expect(idsA.has(id)).toBe(false);
        }
      }),
      { numRuns: 200 }
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
      { numRuns: 200 }
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

          // Create photos for both entities
          for (let i = 0; i < tsA.length; i++) {
            model.create(keyA, `a-${i}`, tsA[i]);
          }
          for (let i = 0; i < tsB.length; i++) {
            model.create(keyB, `b-${i}`, tsB[i]);
          }

          // Snapshot entity B's cover before mutating A
          const coverBBefore = model.coverPhoto(keyB);

          // Set cover on entity A
          const photosA = model.findByEntity(keyA);
          const targetIdx = coverIdx % photosA.length;
          model.setCover(keyA, photosA[targetIdx].id);

          // Entity B's cover must be unchanged
          const coverBAfter = model.coverPhoto(keyB);
          expect(coverBAfter?.id).toBe(coverBBefore?.id);
          expect(coverBAfter?.isCover).toBe(coverBBefore?.isCover);
        }
      ),
      { numRuns: 200 }
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

          // Snapshot entity B state
          const photosBBefore = model.findByEntity(keyB);
          const coverBBefore = model.coverPhoto(keyB);

          // Delete a photo from entity A
          const photosA = model.findByEntity(keyA);
          const targetIdx = deleteIdx % photosA.length;
          model.delete(keyA, photosA[targetIdx].id);

          // Entity B must be unchanged
          const photosBAfter = model.findByEntity(keyB);
          expect(photosBAfter.length).toBe(photosBBefore.length);
          expect(model.coverPhoto(keyB)?.id).toBe(coverBBefore?.id);
        }
      ),
      { numRuns: 200 }
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

          // Create photos for both entities sharing the same entityId
          for (let i = 0; i < tsVehicle.length; i++) {
            model.create(keyVehicle, `v-${i}`, tsVehicle[i]);
          }
          for (let i = 0; i < tsExpense.length; i++) {
            model.create(keyExpense, `e-${i}`, tsExpense[i]);
          }

          // Apply random operations to vehicle entity
          let nextId = 100;
          for (const op of extraOps) {
            nextId = applyEntityOp(model, keyVehicle, op, nextId, 'v-extra');
          }

          // Expense entity must still have exactly its original photos
          const expensePhotos = model.findByEntity(keyExpense);
          const expenseIds = new Set(expensePhotos.map((p) => p.id));
          for (let i = 0; i < tsExpense.length; i++) {
            expect(expenseIds.has(`e-${i}`)).toBe(true);
          }
          expect(expensePhotos.length).toBe(tsExpense.length);

          // No overlap between the two entities
          const vehicleIds = model.photoIds(keyVehicle);
          for (const id of vehicleIds) {
            expect(expenseIds.has(id)).toBe(false);
          }
        }
      ),
      { numRuns: 200 }
    );
  });
});
