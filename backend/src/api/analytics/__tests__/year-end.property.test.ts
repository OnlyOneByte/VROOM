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

let testDb: TestDb;
let repo: AnalyticsRepository;

beforeEach(() => {
  testDb = createTestDb();
  repo = new AnalyticsRepository(testDb.drizzle);
});

afterEach(() => {
  testDb.sqlite.close();
});

const TEST_YEAR = 2024;

function resetDb(): void {
  testDb.sqlite.close();
  testDb = createTestDb();
  repo = new AnalyticsRepository(testDb.drizzle);
}

function setupUserAndVehicle(): { userId: string; vehicle: TestVehicle } {
  const user = { id: 'user-1', email: 'test@test.com', displayName: 'Test' };
  seedUser(testDb.sqlite, user);

  const v: TestVehicle = {
    id: 'vehicle-user-1-0',
    userId: 'user-1',
    make: 'Toyota',
    model: 'Camry',
    year: 2022,
  };
  seedVehicle(testDb.sqlite, v);

  return { userId: user.id, vehicle: v };
}

describe('Biggest expense is the maximum', () => {
  test('biggest expense amount >= every other expense amount in that year', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 10 }), async (expenseCount) => {
        resetDb();
        const { userId, vehicle } = setupUserAndVehicle();

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

        expect(result.biggestExpense).not.toBeNull();

        const maxAmount = Math.max(...seededExpenses.map((e) => e.expenseAmount));
        expect(result.biggestExpense?.amount).toBeCloseTo(maxAmount, 2);

        for (const e of seededExpenses) {
          expect(result.biggestExpense?.amount).toBeGreaterThanOrEqual(e.expenseAmount - 0.001);
        }
      }),
      { numRuns: 100 }
    );
  });
});

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

describe('Year-over-year percentage change formula', () => {
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

const YEAR_END_KEYS = [
  'year',
  'totalSpent',
  'categoryBreakdown',
  'efficiencyTrend',
  'biggestExpense',
  'previousYearComparison',
  'vehicleCount',
  'totalDistance',
  'avgEfficiency',
  'costPerDistance',
  'units',
].sort();

describe('getYearEnd — response shape matches the frontend contract', () => {
  test('the response has exactly the frontend YearEndResponse top-level keys', async () => {
    const { userId } = setupUserAndVehicle();
    const result = await repo.getYearEnd(userId, TEST_YEAR);
    expect(Object.keys(result).sort()).toEqual(YEAR_END_KEYS);
  });

  test('biggestExpense/previousYearComparison are null on an empty year (not absent keys)', async () => {
    const { userId } = setupUserAndVehicle();
    const result = await repo.getYearEnd(userId, TEST_YEAR);
    expect(result.biggestExpense).toBeNull();
    expect(result.previousYearComparison).toBeNull();
    expect(Object.hasOwn(result, 'biggestExpense')).toBe(true);
    expect(Object.hasOwn(result, 'previousYearComparison')).toBe(true);
  });
});
