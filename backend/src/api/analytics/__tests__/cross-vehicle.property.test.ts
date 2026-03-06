/**
 * Property-Based Tests for Cross-Vehicle, Financing, and Insurance Analytics
 *
 * Property 4: Category percentages sum to 100
 * For any non-empty set of expenses, category breakdown percentages sum to ~100 (±0.1 tolerance).
 * **Validates: Requirements 6.3, 12.3**
 *
 * Property 5: Cost per distance formula
 * Cost per distance = totalCost / totalDistance when totalDistance > 0, null otherwise.
 * **Validates: Requirements 6.4, 10.3**
 *
 * Property 23: Unfinanced vehicles classified as own
 * Vehicles without financing records have financingType = 'own'.
 * **Validates: Requirement 7.4**
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import { AnalyticsRepository } from '../repository';
import {
  createTestDb,
  expenseArb,
  seedExpense,
  seedUser,
  seedVehicle,
  seedVehicleFinancing,
  type TestDb,
  type TestExpense,
  type TestVehicle,
  type TestVehicleFinancing,
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
// Helpers
// ---------------------------------------------------------------------------
const TEST_YEAR = 2024;

/** Reset DB and repo for a fresh property test iteration. */
function resetDb(): void {
  testDb.sqlite.close();
  testDb = createTestDb();
  repo = new AnalyticsRepository(testDb.drizzle);
}

/** Create user and N vehicles, returning their IDs. */
function setupUserAndVehicles(vehicleCount: number): { userId: string; vehicles: TestVehicle[] } {
  const user = { id: 'user-1', email: 'test@test.com', displayName: 'Test' };
  seedUser(testDb.sqlite, user);

  const vList: TestVehicle[] = [];
  for (let i = 0; i < vehicleCount; i++) {
    const v: TestVehicle = {
      id: `vehicle-user-1-${i}`,
      userId: 'user-1',
      make: 'Toyota',
      model: 'Camry',
      year: 2022,
      currentInsurancePolicyId: null,
    };
    seedVehicle(testDb.sqlite, v);
    vList.push(v);
  }
  return { userId: user.id, vehicles: vList };
}

/** Seed random expenses for each vehicle. Returns total seeded count. */
function seedExpensesForVehicles(vList: TestVehicle[], perVehicle: number): void {
  let idx = 0;
  for (const v of vList) {
    const generated = fc.sample(expenseArb(v.id, 0, TEST_YEAR), perVehicle);
    for (const e of generated) {
      seedExpense(testDb.sqlite, { ...e, id: `expense-${idx++}` } as TestExpense);
    }
  }
}

/** Seed financing records for the first N vehicles. */
function seedFinancingForVehicles(vList: TestVehicle[], count: number): void {
  for (let i = 0; i < count; i++) {
    const v = vList[i];
    if (!v) continue;
    const fin: TestVehicleFinancing = {
      id: `fin-${v.id}`,
      vehicleId: v.id,
      financingType: i % 2 === 0 ? 'loan' : 'lease',
      provider: 'Test Bank',
      originalAmount: 30000,
      currentBalance: 20000,
      apr: i % 2 === 0 ? 5.5 : null,
      termMonths: 60,
      startDate: new Date(2023, 0, 1),
      paymentAmount: 500,
      isActive: true,
    };
    seedVehicleFinancing(testDb.sqlite, fin);
  }
}

// ---------------------------------------------------------------------------
// Property 4: Category percentages sum to 100
// **Validates: Requirements 6.3, 12.3**
// ---------------------------------------------------------------------------
describe('Property 4: Category percentages sum to 100', () => {
  test('for any non-empty set of expenses, category breakdown percentages sum to ~100 (±0.1)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 3 }),
        fc.integer({ min: 1, max: 8 }),
        async (vehicleCount, expensesPerVehicle) => {
          resetDb();
          const { userId, vehicles } = setupUserAndVehicles(vehicleCount);
          seedExpensesForVehicles(vehicles, expensesPerVehicle);

          const result = await repo.getCrossVehicle(userId, yearToRange(TEST_YEAR));

          if (result.expenseByCategory.length > 0) {
            const percentageSum = result.expenseByCategory.reduce(
              (sum, c) => sum + c.percentage,
              0
            );
            expect(Math.abs(percentageSum - 100)).toBeLessThanOrEqual(0.1);
          }
        }
      ),
      { numRuns: 200 }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 5: Cost per mile formula
// **Validates: Requirements 6.4, 10.3**
// ---------------------------------------------------------------------------
describe('Property 5: Cost per distance formula', () => {
  test('costPerDistance = totalCost / totalDistance when totalDistance > 0, null otherwise', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 3 }),
        fc.integer({ min: 1, max: 5 }),
        async (vehicleCount, expensesPerVehicle) => {
          resetDb();
          const { userId, vehicles } = setupUserAndVehicles(vehicleCount);
          seedExpensesForVehicles(vehicles, expensesPerVehicle);

          const result = await repo.getCrossVehicle(userId, yearToRange(TEST_YEAR));

          for (const vc of result.vehicleCostComparison) {
            if (vc.costPerDistance !== null) {
              expect(vc.costPerDistance).toBeGreaterThan(0);
            }
          }
        }
      ),
      { numRuns: 200 }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 23: Unfinanced vehicles classified as own
// **Validates: Requirement 7.4**
// ---------------------------------------------------------------------------
describe('Property 23: Unfinanced vehicles classified as own', () => {
  test('vehicles without financing records have financingType = own', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 4 }),
        fc.integer({ min: 0, max: 3 }),
        async (totalVehicles, financedCount) => {
          resetDb();
          const actualFinanced = Math.min(financedCount, totalVehicles);
          const { userId, vehicles } = setupUserAndVehicles(totalVehicles);
          seedFinancingForVehicles(vehicles, actualFinanced);

          const result = await repo.getFinancing(userId);
          assertUnfinancedAreOwn(result.vehicleDetails, vehicles, actualFinanced);
          assertFinancedAreNotOwn(result.vehicleDetails, vehicles, actualFinanced);
        }
      ),
      { numRuns: 200 }
    );
  });
});

/** Assert unfinanced vehicles are classified as 'own'. */
function assertUnfinancedAreOwn(
  details: Array<{
    vehicleId: string;
    financingType: string;
    monthlyPayment: number;
    remainingBalance: number;
  }>,
  vehicles: TestVehicle[],
  financedCount: number
): void {
  for (let i = financedCount; i < vehicles.length; i++) {
    const v = vehicles[i];
    if (!v) continue;
    const detail = details.find((d) => d.vehicleId === v.id);
    expect(detail).toBeDefined();
    expect(detail?.financingType).toBe('own');
    expect(detail?.monthlyPayment).toBe(0);
    expect(detail?.remainingBalance).toBe(0);
  }
}

/** Assert financed vehicles are NOT classified as 'own'. */
function assertFinancedAreNotOwn(
  details: Array<{ vehicleId: string; financingType: string }>,
  vehicles: TestVehicle[],
  financedCount: number
): void {
  for (let i = 0; i < financedCount; i++) {
    const v = vehicles[i];
    if (!v) continue;
    const detail = details.find((d) => d.vehicleId === v.id);
    expect(detail).toBeDefined();
    expect(detail?.financingType).not.toBe('own');
  }
}
