/**
 * Property-Based Tests for Odometer UNION Query
 *
 * Tests Property 8: UNION query completeness and source labeling.
 *
 * **Validates: Requirements 6.3, 6.4**
 */

import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import fc from 'fast-check';
import { applyMigration, loadMigrations } from '../../../db/__tests__/migration-helpers';
import type { AppDatabase } from '../../../db/connection';
import * as schema from '../../../db/schema';
import { OdometerRepository } from '../repository';

let sqliteDb: Database;
let db: AppDatabase;
let repo: OdometerRepository;

const USER_ID = 'test-user-odo';
const VEHICLE_ID = 'v-odo-1';

let expenseCounter = 0;
let odometerCounter = 0;

function seedTestData(): void {
  sqliteDb.run(
    `INSERT INTO users (id, email, display_name) VALUES ('${USER_ID}', 'odo@test.com', 'Odo User')`
  );
  sqliteDb.run(
    `INSERT INTO vehicles (id, user_id, make, model, year) VALUES ('${VEHICLE_ID}', '${USER_ID}', 'Honda', 'Civic', 2023)`
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
  repo = new OdometerRepository(db);
  seedTestData();
  expenseCounter = 0;
  odometerCounter = 0;
});

afterEach(() => {
  sqliteDb.close();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function insertExpenseWithMileage(mileage: number, dateUnix: number): string {
  const id = `exp-odo-${++expenseCounter}`;
  sqliteDb.run(
    `INSERT INTO expenses (id, vehicle_id, user_id, category, date, expense_amount, mileage)
     VALUES ('${id}', '${VEHICLE_ID}', '${USER_ID}', 'fuel', ${dateUnix}, 50.00, ${mileage})`
  );
  return id;
}

function insertExpenseWithoutMileage(dateUnix: number): string {
  const id = `exp-nomile-${++expenseCounter}`;
  sqliteDb.run(
    `INSERT INTO expenses (id, vehicle_id, user_id, category, date, expense_amount)
     VALUES ('${id}', '${VEHICLE_ID}', '${USER_ID}', 'maintenance', ${dateUnix}, 100.00)`
  );
  return id;
}

function insertOdometerEntry(odometer: number, dateUnix: number): string {
  const id = `odo-${++odometerCounter}`;
  sqliteDb.run(
    `INSERT INTO odometer_entries (id, vehicle_id, user_id, odometer, recorded_at)
     VALUES ('${id}', '${VEHICLE_ID}', '${USER_ID}', ${odometer}, ${dateUnix})`
  );
  return id;
}

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

const mileageArb = fc.integer({ min: 1000, max: 200000 });
const dateUnixArb = fc.integer({ min: 1600000000, max: 1750000000 });

// ===========================================================================
// Property 8: Odometer UNION query completeness and source labeling
// **Validates: Requirements 6.3, 6.4**
// ===========================================================================
describe('Property 8: Odometer UNION query completeness and source labeling', () => {
  test('UNION returns all expense mileage + manual entries with correct source labels', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.tuple(mileageArb, dateUnixArb), { minLength: 0, maxLength: 5 }),
        fc.array(fc.tuple(mileageArb, dateUnixArb), { minLength: 0, maxLength: 5 }),
        fc.integer({ min: 0, max: 3 }),
        // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Property test with multiple assertions across generated data
        async (expenseMileages, manualEntries, noMileageCount) => {
          const expenseIds: string[] = [];
          const manualIds: string[] = [];

          // Insert expenses with mileage
          for (const [mileage, date] of expenseMileages) {
            expenseIds.push(insertExpenseWithMileage(mileage, date));
          }

          // Insert expenses without mileage (should NOT appear in history)
          for (let i = 0; i < noMileageCount; i++) {
            insertExpenseWithoutMileage(1700000000 + i);
          }

          // Insert manual odometer entries
          for (const [odometer, date] of manualEntries) {
            manualIds.push(insertOdometerEntry(odometer, date));
          }

          const expectedTotal = expenseMileages.length + manualEntries.length;

          // Fetch full history (large limit to get all)
          const result = await repo.getHistory(VEHICLE_ID, { limit: 100, offset: 0 });

          // Total count matches
          expect(result.totalCount).toBe(expectedTotal);
          expect(result.data.length).toBe(expectedTotal);

          // Check source labels
          const expenseEntries = result.data.filter((e) => e.source === 'expense');
          const manualEntriesResult = result.data.filter((e) => e.source === 'manual');

          expect(expenseEntries.length).toBe(expenseMileages.length);
          expect(manualEntriesResult.length).toBe(manualEntries.length);

          // Check source IDs are present
          for (const entry of expenseEntries) {
            expect(expenseIds).toContain(entry.sourceId);
          }
          for (const entry of manualEntriesResult) {
            expect(manualIds).toContain(entry.sourceId);
          }

          // Check ordering: descending by recordedAt
          for (let i = 1; i < result.data.length; i++) {
            expect(result.data[i - 1].recordedAt.getTime()).toBeGreaterThanOrEqual(
              result.data[i].recordedAt.getTime()
            );
          }

          // Clean up
          sqliteDb.run(`DELETE FROM expenses WHERE vehicle_id = '${VEHICLE_ID}'`);
          sqliteDb.run(`DELETE FROM odometer_entries WHERE vehicle_id = '${VEHICLE_ID}'`);
        }
      ),
      { numRuns: 30 }
    );
  });

  test('pagination returns correct subset', async () => {
    // Insert 5 manual entries with known dates
    for (let i = 0; i < 5; i++) {
      insertOdometerEntry(10000 + i * 1000, 1700000000 + i * 86400);
    }

    // Page 1: limit 2, offset 0
    const page1 = await repo.getHistory(VEHICLE_ID, { limit: 2, offset: 0 });
    expect(page1.totalCount).toBe(5);
    expect(page1.data.length).toBe(2);

    // Page 2: limit 2, offset 2
    const page2 = await repo.getHistory(VEHICLE_ID, { limit: 2, offset: 2 });
    expect(page2.totalCount).toBe(5);
    expect(page2.data.length).toBe(2);

    // Page 3: limit 2, offset 4
    const page3 = await repo.getHistory(VEHICLE_ID, { limit: 2, offset: 4 });
    expect(page3.totalCount).toBe(5);
    expect(page3.data.length).toBe(1);

    // No overlap between pages
    const allIds = [...page1.data, ...page2.data, ...page3.data].map((e) => e.sourceId);
    expect(new Set(allIds).size).toBe(5);
  });

  test('empty history returns zero count and empty array', async () => {
    const result = await repo.getHistory(VEHICLE_ID);
    expect(result.totalCount).toBe(0);
    expect(result.data.length).toBe(0);
  });
});
