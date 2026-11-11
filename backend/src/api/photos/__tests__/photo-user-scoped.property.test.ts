/** Property tests: photo create stores userId, and user-scoped queries return only that user's photos. */

import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import fc from 'fast-check';
import { applyMigration, loadMigrations } from '../../../db/__tests__/migration-helpers';
import type { AppDatabase } from '../../../db/connection';
import * as schema from '../../../db/schema';
import { PhotoRepository } from '../photo-repository';

let sqliteDb: Database;
let db: AppDatabase;
let repo: PhotoRepository;

const USER_A = 'user-photo-a';
const USER_B = 'user-photo-b';
const VEHICLE_A = 'v-photo-a';
const VEHICLE_B = 'v-photo-b';

let photoCounter = 0;

function seedTestData(): void {
  sqliteDb.run(
    `INSERT INTO users (id, email, display_name) VALUES ('${USER_A}', 'a@test.com', 'User A')`
  );
  sqliteDb.run(
    `INSERT INTO users (id, email, display_name) VALUES ('${USER_B}', 'b@test.com', 'User B')`
  );
  sqliteDb.run(
    `INSERT INTO vehicles (id, user_id, make, model, year) VALUES ('${VEHICLE_A}', '${USER_A}', 'Toyota', 'Camry', 2022)`
  );
  sqliteDb.run(
    `INSERT INTO vehicles (id, user_id, make, model, year) VALUES ('${VEHICLE_B}', '${USER_B}', 'Honda', 'Civic', 2023)`
  );
}

beforeEach(() => {
  sqliteDb = new Database(':memory:');
  sqliteDb.run('PRAGMA foreign_keys = ON');
  const migrations = loadMigrations();
  for (const m of migrations) {
    applyMigration(sqliteDb, m);
  }
  db = drizzle(sqliteDb, { schema });
  repo = new PhotoRepository(db);
  seedTestData();
  photoCounter = 0;
});

afterEach(() => {
  sqliteDb.close();
});

const entityTypeArb = fc.constantFrom('vehicle', 'expense', 'insurance_policy', 'odometer_entry');

function makePhotoData(userId: string, entityType: string, entityId: string) {
  return {
    userId,
    entityType,
    entityId,
    fileName: `photo-${++photoCounter}.jpg`,
    mimeType: 'image/jpeg',
    fileSize: 1024,
  };
}

describe('photo create stores userId and user-scoped queries work', () => {
  test('created photo stores the correct userId', async () => {
    await fc.assert(
      fc.asyncProperty(entityTypeArb, async (entityType) => {
        const photo = await repo.create(makePhotoData(USER_A, entityType, VEHICLE_A));

        expect(photo.userId).toBe(USER_A);
        expect(photo.entityType).toBe(entityType);

        const retrieved = await repo.findById(photo.id);
        expect(retrieved).not.toBeNull();
        expect(retrieved?.userId).toBe(USER_A);
      }),
      { numRuns: 20 }
    );
  });

  test('findByUser returns only photos belonging to that user', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 4 }),
        fc.integer({ min: 1, max: 4 }),
        async (countA, countB) => {
          for (let i = 0; i < countA; i++) {
            await repo.create(makePhotoData(USER_A, 'vehicle', VEHICLE_A));
          }
          for (let i = 0; i < countB; i++) {
            await repo.create(makePhotoData(USER_B, 'vehicle', VEHICLE_B));
          }

          const photosA = await repo.findByUser(USER_A);
          const photosB = await repo.findByUser(USER_B);

          expect(photosA.length).toBe(countA);
          expect(photosB.length).toBe(countB);

          for (const p of photosA) {
            expect(p.userId).toBe(USER_A);
          }
          for (const p of photosB) {
            expect(p.userId).toBe(USER_B);
          }

          sqliteDb.run(`DELETE FROM photos`);
        }
      ),
      { numRuns: 20 }
    );
  });

  test('findByUser with entityType filter works correctly', async () => {
    await repo.create(makePhotoData(USER_A, 'vehicle', VEHICLE_A));
    await repo.create(makePhotoData(USER_A, 'vehicle', VEHICLE_A));
    await repo.create(makePhotoData(USER_A, 'expense', 'exp-1'));

    const vehiclePhotos = await repo.findByUser(USER_A, 'vehicle');
    const expensePhotos = await repo.findByUser(USER_A, 'expense');
    const allPhotos = await repo.findByUser(USER_A);

    expect(vehiclePhotos.length).toBe(2);
    expect(expensePhotos.length).toBe(1);
    expect(allPhotos.length).toBe(3);
  });
});

// findByEntityPaginated must filter by userId as well as by entity, so one tenant's photos never
// appear in another tenant's page even when entity keys collide.
describe('findByEntityPaginated is userId-scoped', () => {
  test('excludes another user’s photo that shares the same (entityType, entityId)', async () => {
    const SHARED_ENTITY = 'shared-veh';
    await repo.create(makePhotoData(USER_A, 'vehicle', SHARED_ENTITY));
    await repo.create(makePhotoData(USER_A, 'vehicle', SHARED_ENTITY));
    await repo.create(makePhotoData(USER_B, 'vehicle', SHARED_ENTITY));

    const resultA = await repo.findByEntityPaginated('vehicle', SHARED_ENTITY, USER_A, 50, 0);
    expect(resultA.totalCount).toBe(2);
    expect(resultA.data).toHaveLength(2);
    for (const p of resultA.data) {
      expect(p.userId).toBe(USER_A);
    }

    const resultB = await repo.findByEntityPaginated('vehicle', SHARED_ENTITY, USER_B, 50, 0);
    expect(resultB.totalCount).toBe(1);
    expect(resultB.data[0]?.userId).toBe(USER_B);
  });

  test('an owner still gets their photos for the entity (no over-filter)', async () => {
    await repo.create(makePhotoData(USER_A, 'vehicle', VEHICLE_A));
    await repo.create(makePhotoData(USER_A, 'vehicle', VEHICLE_A));

    const result = await repo.findByEntityPaginated('vehicle', VEHICLE_A, USER_A, 50, 0);
    expect(result.totalCount).toBe(2);
    expect(result.data).toHaveLength(2);
  });
});
