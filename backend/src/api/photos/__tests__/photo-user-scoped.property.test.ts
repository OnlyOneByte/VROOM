/**
 * Property-Based Tests for Photo userId Storage and User-Scoped Queries
 *
 * Tests Property 20: Photo create stores userId and user-scoped queries work.
 *
 * **Validates: Requirements 28.1, 28.3**
 */

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

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

const entityTypeArb = fc.constantFrom('vehicle', 'expense', 'insurance_policy', 'odometer_entry');
const _fileNameArb = fc
  .string({ minLength: 3, maxLength: 20 })
  .map((s) => `${s.replace(/[^a-z0-9]/gi, 'x')}.jpg`);

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

// ===========================================================================
// Property 20: Photo create stores userId and user-scoped queries work
// **Validates: Requirements 28.1, 28.3**
// ===========================================================================
describe('Property 20: Photo create stores userId and user-scoped queries work', () => {
  test('created photo stores the correct userId', async () => {
    await fc.assert(
      fc.asyncProperty(entityTypeArb, async (entityType) => {
        const photo = await repo.create(makePhotoData(USER_A, entityType, VEHICLE_A));

        expect(photo.userId).toBe(USER_A);
        expect(photo.entityType).toBe(entityType);

        // Verify via findById
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
          // Create photos for user A
          for (let i = 0; i < countA; i++) {
            await repo.create(makePhotoData(USER_A, 'vehicle', VEHICLE_A));
          }
          // Create photos for user B
          for (let i = 0; i < countB; i++) {
            await repo.create(makePhotoData(USER_B, 'vehicle', VEHICLE_B));
          }

          const photosA = await repo.findByUser(USER_A);
          const photosB = await repo.findByUser(USER_B);

          expect(photosA.length).toBe(countA);
          expect(photosB.length).toBe(countB);

          // All photos for A have userId = USER_A
          for (const p of photosA) {
            expect(p.userId).toBe(USER_A);
          }
          // All photos for B have userId = USER_B
          for (const p of photosB) {
            expect(p.userId).toBe(USER_B);
          }

          // Clean up
          sqliteDb.run(`DELETE FROM photos`);
        }
      ),
      { numRuns: 20 }
    );
  });

  test('countByUser returns correct count per user', async () => {
    // Create 3 photos for A, 2 for B
    for (let i = 0; i < 3; i++) {
      await repo.create(makePhotoData(USER_A, 'vehicle', VEHICLE_A));
    }
    for (let i = 0; i < 2; i++) {
      await repo.create(makePhotoData(USER_B, 'vehicle', VEHICLE_B));
    }

    const countA = await repo.countByUser(USER_A);
    const countB = await repo.countByUser(USER_B);

    expect(countA).toBe(3);
    expect(countB).toBe(2);
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

  test('countByUser with entityType filter works correctly', async () => {
    await repo.create(makePhotoData(USER_A, 'vehicle', VEHICLE_A));
    await repo.create(makePhotoData(USER_A, 'expense', 'exp-1'));
    await repo.create(makePhotoData(USER_A, 'expense', 'exp-2'));

    expect(await repo.countByUser(USER_A, 'vehicle')).toBe(1);
    expect(await repo.countByUser(USER_A, 'expense')).toBe(2);
    expect(await repo.countByUser(USER_A)).toBe(3);
  });
});
