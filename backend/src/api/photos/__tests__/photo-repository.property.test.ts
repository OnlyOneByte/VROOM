/**
 * Property tests over PhotoRepository's cover and entity-isolation rules, run against the real
 * repository on a migrated in-memory SQLite database. After every operation, at most one photo per
 * entity is the cover, and an operation on one entity leaves every other entity's photos and cover
 * exactly as they were.
 */

import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import fc from 'fast-check';
import { applyMigration, loadMigrations } from '../../../db/__tests__/migration-helpers';
import type { AppDatabase } from '../../../db/connection';
import * as schema from '../../../db/schema';
import { PhotoRepository } from '../photo-repository';

const USER = 'user-prop';

let sqliteDb: Database;
let db: AppDatabase;
let repo: PhotoRepository;

beforeEach(() => {
  sqliteDb = new Database(':memory:');
  sqliteDb.run('PRAGMA foreign_keys = ON');
  for (const m of loadMigrations()) applyMigration(sqliteDb, m);
  db = drizzle(sqliteDb, { schema });
  repo = new PhotoRepository(db);
  sqliteDb.run('INSERT INTO users (id, email, display_name) VALUES (?, ?, ?)', [
    USER,
    'prop@test.com',
    'Prop',
  ]);
});

afterEach(() => sqliteDb.close());

interface EntityKey {
  entityType: string;
  entityId: string;
}

/** Shared entityIds across types, so same-id different-type collisions get exercised. */
const ENTITY_KEYS: EntityKey[] = ['vehicle', 'expense', 'trip'].flatMap((entityType) =>
  ['e1', 'e2'].map((entityId) => ({ entityType, entityId }))
);

type Op =
  | { type: 'create'; key: EntityKey }
  | { type: 'setCover'; key: EntityKey; pick: number }
  | { type: 'delete'; key: EntityKey; pick: number };

const keyArb = fc.constantFrom(...ENTITY_KEYS);

const opArb: fc.Arbitrary<Op> = fc.oneof(
  keyArb.map((key): Op => ({ type: 'create', key })),
  fc
    .record({ key: keyArb, pick: fc.nat({ max: 19 }) })
    .map(({ key, pick }): Op => ({ type: 'setCover', key, pick })),
  fc
    .record({ key: keyArb, pick: fc.nat({ max: 19 }) })
    .map(({ key, pick }): Op => ({ type: 'delete', key, pick }))
);

let nextPhotoId = 0;

async function applyOp(op: Op): Promise<void> {
  if (op.type === 'create') {
    await repo.create({
      id: `photo-${++nextPhotoId}`,
      userId: USER,
      entityType: op.key.entityType,
      entityId: op.key.entityId,
      fileName: `f-${nextPhotoId}.jpg`,
      mimeType: 'image/jpeg',
      fileSize: 1024,
      isCover: false,
      sortOrder: 0,
    });
    return;
  }

  const current = await repo.findByEntity(op.key.entityType, op.key.entityId);
  if (current.length === 0) return;
  const target = current[op.pick % current.length];

  if (op.type === 'setCover') {
    await repo.setCoverPhoto(op.key.entityType, op.key.entityId, target.id);
  } else {
    await repo.delete(target.id);
  }
}

/** A stable, comparable view of one entity: each photo id with its cover flag. */
async function snapshot(key: EntityKey): Promise<string[]> {
  const rows = await repo.findByEntity(key.entityType, key.entityId);
  return rows.map((p) => `${p.id}:${p.isCover ? 1 : 0}`).sort();
}

async function snapshotAll(): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  for (const key of ENTITY_KEYS) {
    out.set(`${key.entityType}:${key.entityId}`, await snapshot(key));
  }
  return out;
}

const keyId = (key: EntityKey): string => `${key.entityType}:${key.entityId}`;

describe('PhotoRepository cover and isolation invariants', () => {
  test('after any operation, every entity has at most one cover', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(opArb, { minLength: 1, maxLength: 25 }), async (ops) => {
        sqliteDb.run('DELETE FROM photos');
        for (const op of ops) {
          await applyOp(op);
          for (const key of ENTITY_KEYS) {
            const covers = (await snapshot(key)).filter((s) => s.endsWith(':1'));
            expect(covers.length).toBeLessThanOrEqual(1);
          }
        }
      }),
      { numRuns: 50 }
    );
  });

  test('setCoverPhoto leaves the target as the entity only cover', async () => {
    await fc.assert(
      fc.asyncProperty(
        keyArb,
        fc.integer({ min: 2, max: 6 }),
        fc.nat({ max: 5 }),
        async (key, photoCount, pick) => {
          sqliteDb.run('DELETE FROM photos');
          for (let i = 0; i < photoCount; i++) {
            await applyOp({ type: 'create', key });
          }
          const photos = await repo.findByEntity(key.entityType, key.entityId);
          const target = photos[pick % photos.length];

          await repo.setCoverPhoto(key.entityType, key.entityId, target.id);

          const covers = (await repo.findByEntity(key.entityType, key.entityId))
            .filter((p) => p.isCover)
            .map((p) => p.id);
          expect(covers).toEqual([target.id]);
        }
      ),
      { numRuns: 50 }
    );
  });

  test('an operation on one entity never changes another entity photos or cover', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(opArb, { minLength: 1, maxLength: 25 }), async (ops) => {
        sqliteDb.run('DELETE FROM photos');
        for (const op of ops) {
          const before = await snapshotAll();
          await applyOp(op);
          const after = await snapshotAll();

          for (const key of ENTITY_KEYS) {
            if (keyId(key) === keyId(op.key)) continue;
            expect(after.get(keyId(key))).toEqual(before.get(keyId(key)));
          }
        }
      }),
      { numRuns: 50 }
    );
  });

  test('findByEntity returns only the requested (entityType, entityId) pair', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(opArb, { minLength: 1, maxLength: 25 }), async (ops) => {
        sqliteDb.run('DELETE FROM photos');
        for (const op of ops) {
          await applyOp(op);
        }
        for (const key of ENTITY_KEYS) {
          const rows = await repo.findByEntity(key.entityType, key.entityId);
          for (const row of rows) {
            expect(row.entityType).toBe(key.entityType);
            expect(row.entityId).toBe(key.entityId);
          }
        }
      }),
      { numRuns: 50 }
    );
  });
});
