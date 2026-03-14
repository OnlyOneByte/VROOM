/**
 * Property-Based Tests for Year-End Summary Analytics
 *
 * Property 24: Biggest expense is the maximum
 * For any non-empty set of expenses in a given year, the reported biggest expense
 * amount should be >= every other expense amount in that year.
 * **Validates: Requirement 12.4**
 *
 * Property 25: Year-over-year percentage change formula
 * For any two consecutive years where the previous year has positive total spending,
 * percentageChange = ((currentYearTotal - previousYearTotal) / previousYearTotal) × 100
 * **Validates: Requirement 12.5**
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
  type TestDb,
  type TestExpense,
  type TestVehicle,
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

/** Create user and a single vehicle, returning IDs. */
function setupUserAndVehicle(): { userId: string; vehicle: TestVehicle } {
  const user = { id: 'user-1', email: 'test@test.com', displayName: 'Test' };
  seedUser(testDb.sqlite, user);

  const v: TestVehicle = {
    id: 'vehicle-user-1-0',
    userId: 'user-1',
    make: 'Toyota',
    model: 'Camry',
    year: 2022,
    currentInsurancePolicyId: null,
  };
  seedVehicle(testDb.sqlite, v);

  return { userId: user.id, vehicle: v };
}

// ---------------------------------------------------------------------------
// Property 24: Biggest expense is the maximum
// **Validates: Requirement 12.4**
// ---------------------------------------------------------------------------
describe('Property 24: Biggest expense is the maximum', () => {
  test('biggest expense amount >= every other expense amount in that year', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 10 }), async (expenseCount) => {
        resetDb();
        const { userId, vehicle } = setupUserAndVehicle();

        // Generate and seed expenses for the test year
        const generated = fc.sample(expenseArb(vehicle.id, 0, TEST_YEAR), expenseCount);
        const seededExpenses: TestExpense[] = [];
        for (let i = 0; i < generated.length; i++) {
          const e = generated[i];
          if (!e) continue;
          const expense = { ...e, id: `expense-${i}` } as TestExpense;
          seedExpense(testDb.sqlite, expense);
          seededExpenses.push(expense);
        }

        const result = await repo.getYearEnd(userId, TEST_YEAR);

        if (seededExpenses.length === 0) {
          expect(result.biggestExpense).toBeNull();
          return;
        }

        // biggestExpense must not be null when there are expenses
        expect(result.biggestExpense).not.toBeNull();

        // The biggest expense amount must be >= every seeded expense amount
        const maxAmount = Math.max(...seededExpenses.map((e) => e.expenseAmount));
        expect(result.biggestExpense?.amount).toBeCloseTo(maxAmount, 2);

        // Verify it's >= every individual expense
        for (const e of seededExpenses) {
          expect(result.biggestExpense?.amount).toBeGreaterThanOrEqual(e.expenseAmount - 0.001);
        }
      }),
      { numRuns: 100 }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 25: Year-over-year percentage change formula
// **Validates: Requirement 12.5**
// ---------------------------------------------------------------------------

/** Seed expenses for a given year and return the total amount. */
function seedExpensesForYear(
  vehicleId: string,
  year: number,
  count: number,
  prefix: string
): number {
  const generated = fc.sample(expenseArb(vehicleId, 0, year), count);
  let total = 0;
  for (let i = 0; i < generated.length; i++) {
    const e = generated[i];
    if (!e) continue;
    const expense = { ...e, id: `${prefix}-${i}` } as TestExpense;
    seedExpense(testDb.sqlite, expense);
    total += expense.expenseAmount;
  }
  return total;
}

describe('Property 25: Year-over-year percentage change formula', () => {
  test('percentageChange = ((currentTotal - prevTotal) / prevTotal) * 100', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 5 }),
        fc.integer({ min: 1, max: 5 }),
        async (currentYearCount, prevYearCount) => {
          resetDb();
          const { userId, vehicle } = setupUserAndVehicle();

          const prevTotal = seedExpensesForYear(vehicle.id, TEST_YEAR - 1, prevYearCount, 'prev');
          const currentTotal = seedExpensesForYear(vehicle.id, TEST_YEAR, currentYearCount, 'curr');

          const result = await repo.getYearEnd(userId, TEST_YEAR);

          if (prevTotal <= 0) {
            expect(result.previousYearComparison).toBeNull();
          } else {
            expect(result.previousYearComparison).not.toBeNull();

            const expectedChange = ((currentTotal - prevTotal) / prevTotal) * 100;
            expect(result.previousYearComparison?.percentageChange).toBeCloseTo(expectedChange, 1);
            expect(result.previousYearComparison?.totalSpent).toBeCloseTo(prevTotal, 1);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
