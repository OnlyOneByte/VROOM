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

describe('PhotoRepository.setCoverPhoto', () => {
  test('flips the target to cover and clears the previous cover within the entity', async () => {
    seedPhoto('p1', VEH_1, true);
    seedPhoto('p2', VEH_1, false);

    const result = await repo.setCoverPhoto('vehicle', VEH_1, 'p2');

    expect(result.id).toBe('p2');
    expect(result.isCover).toBe(true);
    expect(coverFlag('p2')).toBe(1);
    expect(coverFlag('p1')).toBe(0);
  });

  test('a photoId from another entity throws and leaves both covers unchanged', async () => {
    seedPhoto('p1', VEH_1, true);
    seedPhoto('p-other', VEH_2, false);

    await expect(repo.setCoverPhoto('vehicle', VEH_1, 'p-other')).rejects.toBeInstanceOf(
      NotFoundError
    );

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
