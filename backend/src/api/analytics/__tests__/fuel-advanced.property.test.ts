/**
 * Property-Based Tests for Fuel Advanced Computation
 *
 * Property 20: Maintenance timeline status assignment
 * For any maintenance timeline item, status should be `overdue` when daysRemaining < 0,
 * `warning` when 0-29, `good` when >= 30.
 *
 * Property 9: All computed scores bounded [0, 100]
 * For any vehicle, all computed scores (vehicle radar scores) should be between 0 and 100 inclusive.
 *
 * Property 21: Fillup interval bucketing completeness
 * For any set of consecutive fuel expenses, the sum of counts across all fillup interval
 * buckets should equal the number of consecutive date gaps.
 *
 * Property 22: Heatmap uses valid expense categories
 * For any monthly cost heatmap entry, the category keys should be exactly the six valid
 * values: fuel, maintenance, financial, regulatory, enhancement, misc.
 *
 * **Validates: Requirements 5.3, 5.4, 5.5, 5.6, 9.3**
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import { AnalyticsRepository } from '../repository';
import {
  createTestDb,
  seedExpense,
  seedUser,
  seedVehicle,
  type TestDb,
  type TestExpense,
  type TestVehicle,
  yearToRange,
} from './analytics-test-generators';

// ---------------------------------------------------------------------------
// Shared setup
// ---------------------------------------------------------------------------
let testDb: TestDb;
let repo: AnalyticsRepository;

beforeEach(() => {
  testDb = createTestDb();
  repo = new AnalyticsRepository(testDb.drizzle);
});

afterEach(() => {
  testDb.sqlite.close();
});

// ---------------------------------------------------------------------------
// Shared test helpers
// ---------------------------------------------------------------------------
const CATEGORIES = [
  'fuel',
  'maintenance',
  'financial',
  'regulatory',
  'enhancement',
  'misc',
] as const;

function resetDb(): void {
  testDb.sqlite.close();
  testDb = createTestDb();
  repo = new AnalyticsRepository(testDb.drizzle);
}

function seedDefaultUserAndVehicle(): TestVehicle {
  const user = { id: 'user-1', email: 'test@test.com', displayName: 'Test' };
  seedUser(testDb.sqlite, user);
  const vehicle: TestVehicle = {
    id: 'vehicle-user-1-0',
    userId: 'user-1',
    make: 'Toyota',
    model: 'Camry',
    year: 2022,
    currentInsurancePolicyId: null,
  };
  seedVehicle(testDb.sqlite, vehicle);
  return vehicle;
}

function seedMultipleVehicles(count: number): TestVehicle[] {
  const user = { id: 'user-1', email: 'test@test.com', displayName: 'Test' };
  seedUser(testDb.sqlite, user);
  const result: TestVehicle[] = [];
  for (let v = 0; v < count; v++) {
    const vehicle: TestVehicle = {
      id: `vehicle-user-1-${v}`,
      userId: 'user-1',
      make: 'Toyota',
      model: `Model${v}`,
      year: 2022,
      currentInsurancePolicyId: null,
    };
    seedVehicle(testDb.sqlite, vehicle);
    result.push(vehicle);
  }
  return result;
}

function seedMixedExpenses(vehicleList: TestVehicle[], perVehicle: number): void {
  let idx = 0;
  for (const vehicle of vehicleList) {
    for (let i = 0; i < perVehicle; i++) {
      const cat = CATEGORIES[i % CATEGORIES.length];
      const expense: TestExpense = {
        id: `exp-${idx++}`,
        vehicleId: vehicle.id,
        category: cat,
        expenseAmount: 20 + i * 15,
        date: new Date(2024, i % 12, 10 + (i % 15)),
        mileage: cat === 'fuel' ? 10000 + i * 300 : null,
        fuelAmount: cat === 'fuel' ? 8 + (i % 10) : null,
        fuelType: cat === 'fuel' ? 'Regular' : null,
        missedFillup: false,
      };
      seedExpense(testDb.sqlite, expense);
    }
  }
}

function assertScoreBounded(value: number): void {
  expect(value).toBeGreaterThanOrEqual(0);
  expect(value).toBeLessThanOrEqual(100);
}

// ---------------------------------------------------------------------------
// Property 20: Maintenance timeline status assignment
// **Validates: Requirement 5.3**
// ---------------------------------------------------------------------------
describe('Property 20: Maintenance timeline status assignment', () => {
  test('status is overdue when daysRemaining < 0, warning when 0-29, good when >= 30', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 5 }),
        fc.integer({ min: 30, max: 365 }),
        async (serviceCount, daysBetween) => {
          resetDb();
          const vehicle = seedDefaultUserAndVehicle();

          const now = new Date();
          for (let i = 0; i < serviceCount; i++) {
            const expenseDate = new Date(
              now.getTime() - (serviceCount - i) * daysBetween * 24 * 60 * 60 * 1000
            );
            const expense: TestExpense = {
              id: `maint-${i}`,
              vehicleId: vehicle.id,
              category: 'maintenance',
              expenseAmount: 100,
              date: expenseDate,
              mileage: 10000 + i * 5000,
              fuelAmount: null,
              fuelType: null,
              missedFillup: false,
            };
            seedExpense(testDb.sqlite, expense);
          }

          const result = await repo.getFuelAdvanced('user-1', yearToRange(now.getFullYear()));

          for (const item of result.maintenanceTimeline) {
            if (item.daysRemaining < 0) {
              expect(item.status).toBe('overdue');
            } else if (item.daysRemaining < 30) {
              expect(item.status).toBe('warning');
            } else {
              expect(item.status).toBe('good');
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 9: All computed scores bounded [0, 100]
// **Validates: Requirements 9.3, 5.4**
// ---------------------------------------------------------------------------
describe('Property 9: All computed scores bounded [0, 100]', () => {
  test('all vehicle radar scores are between 0 and 100 inclusive', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 4 }),
        fc.integer({ min: 1, max: 8 }),
        async (vehicleCount, expensesPerVehicle) => {
          resetDb();
          const vehicleList = seedMultipleVehicles(vehicleCount);
          seedMixedExpenses(vehicleList, expensesPerVehicle);

          const result = await repo.getFuelAdvanced('user-1', yearToRange(2024));

          for (const radar of result.vehicleRadar) {
            assertScoreBounded(radar.fuelEfficiency);
            assertScoreBounded(radar.maintenanceCost);
            assertScoreBounded(radar.reliability);
            assertScoreBounded(radar.annualCost);
            assertScoreBounded(radar.mileage);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 21: Fillup interval bucketing completeness
// **Validates: Requirement 5.5**
// ---------------------------------------------------------------------------
describe('Property 21: Fillup interval bucketing completeness', () => {
  test('sum of bucket counts equals number of consecutive date gaps', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 2, max: 15 }), async (expenseCount) => {
        resetDb();
        const vehicle = seedDefaultUserAndVehicle();

        for (let i = 0; i < expenseCount; i++) {
          const expense: TestExpense = {
            id: `fuel-${i}`,
            vehicleId: vehicle.id,
            category: 'fuel',
            expenseAmount: 40 + i,
            date: new Date(2024, 0, 2 + i * 3),
            mileage: 10000 + i * 300,
            fuelAmount: 10,
            fuelType: 'Regular',
            missedFillup: false,
          };
          seedExpense(testDb.sqlite, expense);
        }

        const result = await repo.getFuelAdvanced('user-1', yearToRange(2024));

        const totalBucketCount = result.fillupIntervals.reduce(
          (sum, bucket) => sum + bucket.count,
          0
        );
        expect(totalBucketCount).toBe(expenseCount - 1);
      }),
      { numRuns: 100 }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 22: Heatmap uses valid expense categories
// **Validates: Requirement 5.6**
// ---------------------------------------------------------------------------
function seedCategorizedExpenses(vehicleId: string, count: number): void {
  for (let i = 0; i < count; i++) {
    const cat = CATEGORIES[i % CATEGORIES.length];
    const expense: TestExpense = {
      id: `exp-${i}`,
      vehicleId,
      category: cat,
      expenseAmount: 50 + i * 10,
      date: new Date(2024, i % 12, 10),
      mileage: cat === 'fuel' ? 10000 + i * 300 : null,
      fuelAmount: cat === 'fuel' ? 10 : null,
      fuelType: cat === 'fuel' ? 'Regular' : null,
      missedFillup: false,
    };
    seedExpense(testDb.sqlite, expense);
  }
}

describe('Property 22: Heatmap uses valid expense categories', () => {
  test('every heatmap entry has exactly the six valid category keys', async () => {
    const expectedKeys = [
      'enhancement',
      'financial',
      'fuel',
      'maintenance',
      'misc',
      'month',
      'regulatory',
    ];

    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 10 }), async (expenseCount) => {
        resetDb();
        const vehicle = seedDefaultUserAndVehicle();
        seedCategorizedExpenses(vehicle.id, expenseCount);

        const result = await repo.getFuelAdvanced('user-1', yearToRange(2024));

        for (const entry of result.monthlyCostHeatmap) {
          expect(Object.keys(entry).sort()).toEqual(expectedKeys);
          for (const cat of CATEGORIES) {
            expect(entry[cat]).toBeGreaterThanOrEqual(0);
          }
        }
      }),
      { numRuns: 100 }
    );
  });
});
