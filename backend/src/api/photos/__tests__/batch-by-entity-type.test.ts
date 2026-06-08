/**
 * Tests for the batch photo-fetch primitive behind GET /api/v1/photos?entityType=.
 *
 * The dashboard used to fetch photos one request per vehicle (N+1). The batch
 * endpoint calls photoRepository.findByUser(userId, entityType) once and groups
 * the rows by entityId. These tests pin the two properties that make that safe:
 *   - the query is user-scoped (never returns another user's photos)
 *   - the query is entity-type-scoped (vehicle photos only, not expense photos)
 * plus the grouping shape the service produces.
 */

import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { applyMigration, loadMigrations } from '../../../db/__tests__/migration-helpers';
import type { AppDatabase } from '../../../db/connection';
import type { Photo } from '../../../db/schema';
import * as schema from '../../../db/schema';
import { PhotoRepository } from '../photo-repository';

let sqliteDb: Database;
let db: AppDatabase;
let repo: PhotoRepository;

const USER_A = 'user-a';
const USER_B = 'user-b';
const VEH_A1 = 'veh-a1';
const VEH_A2 = 'veh-a2';
const VEH_B1 = 'veh-b1';

let counter = 0;

function seed(): void {
  sqliteDb.run(
    `INSERT INTO users (id, email, display_name) VALUES ('${USER_A}', 'a@test.com', 'A'), ('${USER_B}', 'b@test.com', 'B')`
  );
  sqliteDb.run(
    `INSERT INTO vehicles (id, user_id, make, model, year) VALUES
      ('${VEH_A1}', '${USER_A}', 'Toyota', 'Camry', 2022),
      ('${VEH_A2}', '${USER_A}', 'Mazda', 'CX5', 2023),
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

function addPhoto(userId: string, entityType: string, entityId: string) {
  return repo.create({
    userId,
    entityType,
    entityId,
    fileName: `p-${++counter}.jpg`,
    mimeType: 'image/jpeg',
    fileSize: 1024,
  });
}

/** Mirror of the service's grouping (service binds the singleton repo). */
function groupByEntityId(photos: Photo[]): Record<string, Photo[]> {
  const grouped: Record<string, Photo[]> = {};
  for (const p of photos) {
    const bucket = grouped[p.entityId];
    if (bucket) {
      bucket.push(p);
    } else {
      grouped[p.entityId] = [p];
    }
  }
  return grouped;
}

describe('batch photos by entity type', () => {
  test("groups a user's vehicle photos by vehicleId", async () => {
    await addPhoto(USER_A, 'vehicle', VEH_A1);
    await addPhoto(USER_A, 'vehicle', VEH_A1);
    await addPhoto(USER_A, 'vehicle', VEH_A2);

    const grouped = groupByEntityId(await repo.findByUser(USER_A, 'vehicle'));

    expect(Object.keys(grouped).sort()).toEqual([VEH_A1, VEH_A2].sort());
    expect(grouped[VEH_A1]).toHaveLength(2);
    expect(grouped[VEH_A2]).toHaveLength(1);
  });

  test("never returns another user's photos", async () => {
    await addPhoto(USER_A, 'vehicle', VEH_A1);
    await addPhoto(USER_B, 'vehicle', VEH_B1);

    const grouped = groupByEntityId(await repo.findByUser(USER_A, 'vehicle'));

    expect(grouped[VEH_B1]).toBeUndefined();
    expect(Object.keys(grouped)).toEqual([VEH_A1]);
  });

  test('filters by entity type — expense photos excluded from vehicle batch', async () => {
    await addPhoto(USER_A, 'vehicle', VEH_A1);
    await addPhoto(USER_A, 'expense', 'exp-1');

    const grouped = groupByEntityId(await repo.findByUser(USER_A, 'vehicle'));

    expect(Object.keys(grouped)).toEqual([VEH_A1]);
    expect(grouped['exp-1']).toBeUndefined();
  });

  test('returns an empty object when the user has no photos of that type', async () => {
    const grouped = groupByEntityId(await repo.findByUser(USER_A, 'vehicle'));
    expect(grouped).toEqual({});
  });
});
