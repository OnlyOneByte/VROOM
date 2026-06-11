/**
 * Direct PhotoRepository.setCoverPhoto tests (C229 bug → entity-scoped second UPDATE).
 *
 * The two photo "property" tests (photo-repository.property.test.ts + photo-service.property.test.ts)
 * only exercise an in-memory REFERENCE model — neither drives the REAL setCoverPhoto (the C181
 * coverage-theater anti-pattern), so the method's WHERE predicate was unpinned. These tests run the
 * real repo over a migrated in-memory SQLite DB (the batch-by-entity-type.test.ts pattern).
 *
 * The original bug: setCoverPhoto's first UPDATE clears THIS entity's covers scoped by
 * (entityType, entityId), but the second (set-cover) UPDATE keyed on `id` ALONE — so a photoId
 * belonging to a DIFFERENT entity would clear the named entity's cover AND wrongly flag the foreign
 * photo (leaving the named entity cover-less). The fix VALIDATES the target's (id, entityType,
 * entityId) match BEFORE any write — because the bun:sqlite async-transaction footgun (the C151
 * lesson) means a throw AFTER the unset would NOT roll the unset back, so an unset-then-throw would
 * still leave the entity cover-less. Validate-first guarantees no mutation on a bad/foreign id.
 */

import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { applyMigration, loadMigrations } from '../../../db/__tests__/migration-helpers';
import type { AppDatabase } from '../../../db/connection';
import * as schema from '../../../db/schema';
import { NotFoundError } from '../../../errors';
import { PhotoRepository } from '../photo-repository';

let sqliteDb: Database;
let db: AppDatabase;
let repo: PhotoRepository;

const USER = 'user-a';
const VEH_1 = 'veh-1';
const VEH_2 = 'veh-2';

function seedPhoto(id: string, vehicleId: string, isCover: boolean): void {
  sqliteDb.run(
    `INSERT INTO photos (id, user_id, entity_type, entity_id, file_name, mime_type, file_size, is_cover, sort_order)
     VALUES (?, ?, 'vehicle', ?, ?, 'image/jpeg', 1024, ?, 0)`,
    [id, USER, vehicleId, `${id}.jpg`, isCover ? 1 : 0]
  );
}

function coverFlag(id: string): number {
  return (
    sqliteDb.query('SELECT is_cover FROM photos WHERE id = ?').get(id) as { is_cover: number }
  ).is_cover;
}

beforeEach(() => {
  sqliteDb = new Database(':memory:');
  sqliteDb.run('PRAGMA foreign_keys = ON');
  for (const m of loadMigrations()) applyMigration(sqliteDb, m);
  db = drizzle(sqliteDb, { schema });
  repo = new PhotoRepository(db);
  sqliteDb.run(`INSERT INTO users (id, email, display_name) VALUES ('${USER}', 'a@test.com', 'A')`);
  sqliteDb.run(
    `INSERT INTO vehicles (id, user_id, make, model, year) VALUES
      ('${VEH_1}', '${USER}', 'Toyota', 'Camry', 2022),
      ('${VEH_2}', '${USER}', 'Mazda', 'CX5', 2023)`
  );
});

afterEach(() => sqliteDb.close());

describe('PhotoRepository.setCoverPhoto (entity-scoped second UPDATE)', () => {
  test('flips the target to cover and clears the previous cover within the entity', async () => {
    seedPhoto('p1', VEH_1, true);
    seedPhoto('p2', VEH_1, false);

    const result = await repo.setCoverPhoto('vehicle', VEH_1, 'p2');

    expect(result.id).toBe('p2');
    expect(result.isCover).toBe(true);
    expect(coverFlag('p2')).toBe(1);
    expect(coverFlag('p1')).toBe(0);
  });

  test('a photoId from a DIFFERENT entity matches 0 rows → throws + rolls back the unset', async () => {
    // VEH_1 has a cover (p1); the foreign photo p-other belongs to VEH_2.
    seedPhoto('p1', VEH_1, true);
    seedPhoto('p-other', VEH_2, false);

    await expect(repo.setCoverPhoto('vehicle', VEH_1, 'p-other')).rejects.toBeInstanceOf(
      NotFoundError
    );

    // Validate-first: no write happened, so VEH_1 keeps its original cover + the foreign photo is untouched.
    expect(coverFlag('p1')).toBe(1);
    expect(coverFlag('p-other')).toBe(0);
  });

  test('an unknown photoId throws NotFoundError and leaves the existing cover intact', async () => {
    seedPhoto('p1', VEH_1, true);

    await expect(repo.setCoverPhoto('vehicle', VEH_1, 'nope')).rejects.toBeInstanceOf(
      NotFoundError
    );

    expect(coverFlag('p1')).toBe(1);
  });
});
