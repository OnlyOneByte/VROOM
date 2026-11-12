import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { applyMigration, loadMigrations } from '../../../db/__tests__/migration-helpers';
import type { AppDatabase } from '../../../db/connection';
import * as schema from '../../../db/schema';
import { PhotoRepository } from '../photo-repository';

let sqliteDb: Database;
let db: AppDatabase;
let repo: PhotoRepository;

const USER_A = 'user-a';
const VEH_A1 = 'veh-a1';

let counter = 0;

beforeEach(() => {
  sqliteDb = new Database(':memory:');
  sqliteDb.run('PRAGMA foreign_keys = ON');
  for (const m of loadMigrations()) applyMigration(sqliteDb, m);
  db = drizzle(sqliteDb, { schema });
  repo = new PhotoRepository(db);
  sqliteDb.run(
    `INSERT INTO users (id, email, display_name) VALUES ('${USER_A}', 'a@test.com', 'A')`
  );
  sqliteDb.run(
    `INSERT INTO vehicles (id, user_id, make, model, year) VALUES ('${VEH_A1}', '${USER_A}', 'Toyota', 'Camry', 2022)`
  );
  counter = 0;
});

afterEach(() => {
  sqliteDb.close();
});

function addPhoto(userId: string, entityType: string, entityId: string) {
  return repo.create({
    userId,
    entityType,
    entityId,
    fileName: `p-${++counter}.jpg`,
    mimeType: 'image/jpeg',
    fileSize: 1024,
    isCover: false,
  });
}

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
