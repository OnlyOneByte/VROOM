/**
 * Tests for the three previously-UNCOVERED PhotoRepository finder methods (C126 guard):
 * `findIdsByUser`, `findById`, `findCoverPhoto` (coverage showed lines 47-69/134-148 untested).
 * Drives the REAL repo over a migrated in-memory SQLite DB (the batch-by-entity-type.test.ts
 * pattern — constructor-injected `this.db`, NOT the getDb singleton, so this is real coverage and
 * not the C229 coverage-theater trap).
 *
 * The load-bearing properties pinned:
 *   - findIdsByUser is USER-scoped + optionally entity-type-scoped + honors extraConditions — it's
 *     the bulk-delete id finder, so a dropped userId scope would leak/operate on another tenant's
 *     photo ids (the #48/#72/#180 tenant-scope-at-the-read class).
 *   - findById returns the row or null on miss (no throw).
 *   - findCoverPhoto returns ONLY the isCover=true row for the entity, null when none is flagged.
 */

import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { applyMigration, loadMigrations } from '../../../db/__tests__/migration-helpers';
import type { AppDatabase } from '../../../db/connection';
import * as schema from '../../../db/schema';
import { photos } from '../../../db/schema';
import { PhotoRepository } from '../photo-repository';

let sqliteDb: Database;
let db: AppDatabase;
let repo: PhotoRepository;

const USER_A = 'user-a';
const USER_B = 'user-b';
const VEH_A1 = 'veh-a1';
const VEH_B1 = 'veh-b1';

let counter = 0;

function seed(): void {
  sqliteDb.run(
    `INSERT INTO users (id, email, display_name) VALUES ('${USER_A}', 'a@test.com', 'A'), ('${USER_B}', 'b@test.com', 'B')`
  );
  sqliteDb.run(
    `INSERT INTO vehicles (id, user_id, make, model, year) VALUES
      ('${VEH_A1}', '${USER_A}', 'Toyota', 'Camry', 2022),
      ('${VEH_B1}', '${USER_B}', 'Honda', 'Civic', 2021)`
  );
}

beforeEach(() => {
  sqliteDb = new Database(':memory:');
  sqliteDb.run('PRAGMA foreign_keys = ON');
  for (const m of loadMigrations()) applyMigration(sqliteDb, m);
  db = drizzle(sqliteDb, { schema });
  repo = new PhotoRepository(db);
  seed();
  counter = 0;
});

afterEach(() => {
  sqliteDb.close();
});

function addPhoto(
  userId: string,
  entityType: string,
  entityId: string,
  over: { isCover?: boolean } = {}
) {
  return repo.create({
    userId,
    entityType,
    entityId,
    fileName: `p-${++counter}.jpg`,
    mimeType: 'image/jpeg',
    fileSize: 1024,
    isCover: over.isCover ?? false,
  });
}

describe('PhotoRepository.findIdsByUser', () => {
  test('returns only the ids belonging to the user', async () => {
    const a1 = await addPhoto(USER_A, 'vehicle', VEH_A1);
    await addPhoto(USER_B, 'vehicle', VEH_B1);

    const ids = await repo.findIdsByUser(USER_A);
    expect(ids).toEqual([a1.id]);
  });

  test('entityType filter narrows to that type', async () => {
    const veh = await addPhoto(USER_A, 'vehicle', VEH_A1);
    await addPhoto(USER_A, 'expense', 'exp-1');

    const ids = await repo.findIdsByUser(USER_A, 'vehicle');
    expect(ids).toEqual([veh.id]);
  });

  test('honors an extraConditions clause (AND-merged with the user scope)', async () => {
    const cover = await addPhoto(USER_A, 'vehicle', VEH_A1, { isCover: true });
    await addPhoto(USER_A, 'vehicle', VEH_A1, { isCover: false });

    const ids = await repo.findIdsByUser(USER_A, 'vehicle', and(eq(photos.isCover, true)));
    expect(ids).toEqual([cover.id]);
  });

  test('returns an empty array for a user with no photos', async () => {
    expect(await repo.findIdsByUser(USER_B)).toEqual([]);
  });
});

describe('PhotoRepository.findById', () => {
  test('returns the row for an existing id', async () => {
    const p = await addPhoto(USER_A, 'vehicle', VEH_A1);
    const found = await repo.findById(p.id);
    expect(found?.id).toBe(p.id);
    expect(found?.userId).toBe(USER_A);
  });

  test('returns null for a non-existent id (no throw)', async () => {
    expect(await repo.findById('does-not-exist')).toBeNull();
  });
});

describe('PhotoRepository.findCoverPhoto', () => {
  test('returns the isCover=true photo for the entity', async () => {
    await addPhoto(USER_A, 'vehicle', VEH_A1, { isCover: false });
    const cover = await addPhoto(USER_A, 'vehicle', VEH_A1, { isCover: true });

    const found = await repo.findCoverPhoto('vehicle', VEH_A1);
    expect(found?.id).toBe(cover.id);
    expect(found?.isCover).toBe(true);
  });

  test('returns null when the entity has photos but none is flagged cover', async () => {
    await addPhoto(USER_A, 'vehicle', VEH_A1, { isCover: false });
    expect(await repo.findCoverPhoto('vehicle', VEH_A1)).toBeNull();
  });

  test('returns null for an entity with no photos at all', async () => {
    expect(await repo.findCoverPhoto('vehicle', 'no-such-vehicle')).toBeNull();
  });
});
