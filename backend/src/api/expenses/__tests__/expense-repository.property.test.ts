/**
 * Property-Based Tests for ExpenseRepository (DB-backed)
 *
 * Property 5 (Design): Split expense update preserves groupId and migrates photos
 * - Update preserves groupId: new siblings share the same groupId as old siblings
 * - Photos migrate to first new sibling: all photos from old siblings are reassigned
 *
 * **Validates: Requirements 6.1, 6.2**
 */

import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createId } from '@paralleldrive/cuid2';
import { eq } from 'drizzle-orm';
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import fc from 'fast-check';
import { applyMigration, loadMigrations } from '../../../db/__tests__/migration-helpers';
import { expenses, photos } from '../../../db/schema';
import { ExpenseRepository } from '../repository';
import type { SplitConfig } from '../validation';

// ---------------------------------------------------------------------------
// Test infrastructure
// ---------------------------------------------------------------------------

let sqliteDb: Database;
let db: BunSQLiteDatabase<Record<string, unknown>>;
let repo: ExpenseRepository;

const USER_ID = 'test-user-1';
const VEHICLE_IDS = ['v-1', 'v-2', 'v-3', 'v-4', 'v-5'];

function seedTestData(): void {
  sqliteDb.run(
    `INSERT INTO users (id, email, display_name, provider, provider_id) VALUES ('${USER_ID}', 'user1@test.com', 'User One', 'google', 'gid-1')`
  );
  for (const vid of VEHICLE_IDS) {
    sqliteDb.run(
      `INSERT INTO vehicles (id, user_id, make, model, year) VALUES ('${vid}', '${USER_ID}', 'Toyota', 'Camry', 2022)`
    );
  }
}

beforeEach(() => {
  sqliteDb = new Database(':memory:');
  sqliteDb.run('PRAGMA foreign_keys = ON');
  const migrations = loadMigrations();
  for (const m of migrations) {
    applyMigration(sqliteDb, m);
  }
  db = drizzle(sqliteDb);
  repo = new ExpenseRepository(db);
  seedTestData();
});

afterEach(() => {
  sqliteDb.close();
});

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/** Positive dollar amount (0.01 – 10 000), rounded to cents */
const positiveAmountArb = fc
  .double({ min: 0.01, max: 10_000, noNaN: true })
  .map((v) => Math.round(v * 100) / 100)
  .filter((v) => v >= 0.01);

/** Pick 2–5 unique vehicle IDs from the seeded set. */
const dbVehicleIdsArb = fc
  .subarray(VEHICLE_IDS, { minLength: 2, maxLength: VEHICLE_IDS.length })
  .filter((arr) => arr.length >= 2);

/** Even split config using seeded vehicle IDs. */
const dbEvenConfigArb: fc.Arbitrary<SplitConfig> = dbVehicleIdsArb.map((vehicleIds) => ({
  method: 'even' as const,
  vehicleIds,
}));

/** Percentage split config using seeded vehicle IDs. */
const dbPercentageConfigArb: fc.Arbitrary<SplitConfig> = dbVehicleIdsArb.chain((vehicleIds) => {
  const n = vehicleIds.length;
  return fc
    .array(fc.integer({ min: 1, max: 10000 }), { minLength: n, maxLength: n })
    .map((weights) => {
      const weightSum = weights.reduce((s, w) => s + w, 0);
      const pcts = weights.map((w) => Math.floor((w / weightSum) * 100));
      let remainder = 100 - pcts.reduce((s, p) => s + p, 0);
      for (let i = 0; remainder > 0; i++) {
        pcts[i]++;
        remainder--;
      }
      const allocations = vehicleIds.map((vehicleId, i) => ({
        vehicleId,
        percentage: pcts[i],
      }));
      return { method: 'percentage' as const, allocations };
    });
});

/** Absolute split config using seeded vehicle IDs, amounts summing to totalAmount. */
const dbAbsoluteConfigArb = (totalAmount: number): fc.Arbitrary<SplitConfig> =>
  dbVehicleIdsArb.chain((vehicleIds) => {
    const n = vehicleIds.length;
    const totalCents = Math.round(totalAmount * 100);
    return fc
      .array(fc.integer({ min: 1, max: 10000 }), { minLength: n, maxLength: n })
      .map((weights) => {
        const weightSum = weights.reduce((s, w) => s + w, 0);
        const cents = weights.map((w) => Math.floor((w / weightSum) * totalCents));
        let rem = totalCents - cents.reduce((s, c) => s + c, 0);
        for (let i = 0; rem > 0; i++) {
          cents[i]++;
          rem--;
        }
        const allocations = vehicleIds.map((vehicleId, i) => ({
          vehicleId,
          amount: cents[i] / 100,
        }));
        return { method: 'absolute' as const, allocations };
      });
  });

/** Combined: split config + matching totalAmount. */
const dbConfigAndTotalArb: fc.Arbitrary<{ config: SplitConfig; totalAmount: number }> =
  positiveAmountArb.chain((totalAmount) =>
    fc.oneof(
      dbEvenConfigArb.map((config) => ({ config, totalAmount })),
      dbPercentageConfigArb.map((config) => ({ config, totalAmount })),
      dbAbsoluteConfigArb(totalAmount).map((config) => ({ config, totalAmount }))
    )
  );

/** Number of photos to attach (0–5). */
const photoCountArb = fc.integer({ min: 0, max: 5 });

/** Category arbitrary. */
const categoryArb = fc.constantFrom(
  'fuel',
  'maintenance',
  'financial',
  'regulatory',
  'enhancement',
  'misc'
);

// ---------------------------------------------------------------------------
// Helper: insert photos attached to expense IDs
// ---------------------------------------------------------------------------
async function insertPhotos(
  drizzleDb: BunSQLiteDatabase<Record<string, unknown>>,
  expenseIds: string[],
  count: number
): Promise<string[]> {
  const photoIds: string[] = [];
  for (let i = 0; i < count; i++) {
    // Distribute photos across old siblings round-robin
    const targetExpenseId = expenseIds[i % expenseIds.length] as string;
    const photoId = createId();
    await drizzleDb.insert(photos).values({
      id: photoId,
      entityType: 'expense',
      entityId: targetExpenseId,
      fileName: `photo-${i}.jpg`,
      mimeType: 'image/jpeg',
      fileSize: 1024,
    });
    photoIds.push(photoId);
  }
  return photoIds;
}

// ---------------------------------------------------------------------------
// Property 5 (Design): Split expense update preserves groupId and migrates photos
// For any split expense update operation, the new sibling rows must share the
// same groupId as the old sibling rows. All photos from old siblings must be
// reassigned to the first new sibling after the update.
// **Validates: Requirements 6.1, 6.2**
// ---------------------------------------------------------------------------
describe('Property 5 (Design): Split expense update preserves groupId and migrates photos', () => {
  test('update preserves groupId: new siblings share the same groupId as old siblings', async () => {
    await fc.assert(
      fc.asyncProperty(
        dbConfigAndTotalArb,
        dbConfigAndTotalArb,
        categoryArb,
        async (initial, updated, category) => {
          // 1. Create a split expense
          const oldSiblings = await repo.createSplitExpense(
            {
              splitConfig: initial.config,
              category,
              date: new Date(2024, 5, 15),
              totalAmount: initial.totalAmount,
            },
            USER_ID
          );

          const originalGroupId = oldSiblings[0]?.groupId;
          expect(originalGroupId).toBeTruthy();

          // 2. Update the split expense with a different config
          const newSiblings = await repo.updateSplitExpense(
            originalGroupId as string,
            { splitConfig: updated.config, totalAmount: updated.totalAmount },
            USER_ID
          );

          // 3. Verify: all new siblings share the same groupId as the old ones
          for (const sibling of newSiblings) {
            expect(sibling.groupId).toBe(originalGroupId);
          }

          // 4. Verify from DB: all rows with this groupId have the correct groupId
          const dbSiblings = await db
            .select()
            .from(expenses)
            .where(eq(expenses.groupId, originalGroupId as string));

          expect(dbSiblings.length).toBe(newSiblings.length);
          for (const row of dbSiblings) {
            expect(row.groupId).toBe(originalGroupId);
          }
        }
      ),
      { numRuns: 50 }
    );
  });

  test('photos from old siblings migrate to the first new sibling', async () => {
    await fc.assert(
      fc.asyncProperty(
        dbConfigAndTotalArb,
        dbConfigAndTotalArb,
        categoryArb,
        photoCountArb,
        async (initial, updated, category, photoCount) => {
          // 1. Create a split expense
          const oldSiblings = await repo.createSplitExpense(
            {
              splitConfig: initial.config,
              category,
              date: new Date(2024, 5, 15),
              totalAmount: initial.totalAmount,
            },
            USER_ID
          );

          const originalGroupId = oldSiblings[0]?.groupId;
          expect(originalGroupId).toBeTruthy();
          const oldSiblingIds = oldSiblings.map((s) => s.id);

          // 2. Insert photos attached to old siblings
          const insertedPhotoIds = await insertPhotos(db, oldSiblingIds, photoCount);

          // 3. Update the split expense
          const newSiblings = await repo.updateSplitExpense(
            originalGroupId as string,
            { splitConfig: updated.config, totalAmount: updated.totalAmount },
            USER_ID
          );

          const firstNewSiblingId = newSiblings[0]?.id;

          // 4. Verify: all photos now point to the first new sibling
          if (insertedPhotoIds.length > 0) {
            const migratedPhotos = await db
              .select()
              .from(photos)
              .where(eq(photos.entityType, 'expense'));

            const relevantPhotos = migratedPhotos.filter((p) => insertedPhotoIds.includes(p.id));

            expect(relevantPhotos.length).toBe(insertedPhotoIds.length);

            for (const photo of relevantPhotos) {
              expect(photo.entityId).toBe(firstNewSiblingId);
              expect(photo.entityType).toBe('expense');
            }
          }

          // 5. Verify: no photos point to any old sibling ID
          for (const oldId of oldSiblingIds) {
            const orphaned = await db.select().from(photos).where(eq(photos.entityId, oldId));
            expect(orphaned.length).toBe(0);
          }
        }
      ),
      { numRuns: 50 }
    );
  });
});
