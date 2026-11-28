import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import { AnalyticsRepository } from '../repository';
import {
  type AnalyticsTestDb,
  openAnalyticsTestDb,
  seedExpense,
  seedUser,
  seedVehicle,
} from './analytics-test-db';
import { expenseArb, type TestExpense, type TestVehicle } from './analytics-test-generators';

let testDb: AnalyticsTestDb;
let repo: AnalyticsRepository;

beforeEach(async () => {
  testDb = await openAnalyticsTestDb();
  repo = new AnalyticsRepository(testDb.asyncDb);
});

afterEach(() => {
  testDb.close();
});

const TEST_YEAR = 2024;

async function resetDb(): Promise<void> {
  await testDb.sql.run('DELETE FROM expenses');
  await testDb.sql.run('DELETE FROM vehicles');
  await testDb.sql.run('DELETE FROM users');
  repo = new AnalyticsRepository(testDb.asyncDb);
}

async function setupUserAndVehicle(): Promise<{ userId: string; vehicle: TestVehicle }> {
  const user = { id: 'user-1', email: 'test@test.com', displayName: 'Test' };
  await seedUser(testDb.sql, user);

  const v: TestVehicle = {
    id: 'vehicle-user-1-0',
    userId: 'user-1',
    make: 'Toyota',
    model: 'Camry',
    year: 2022,
  };
  await seedVehicle(testDb.sql, v);

  return { userId: user.id, vehicle: v };
}

describe('Biggest expense is the maximum', () => {
  test('biggest expense amount >= every other expense amount in that year', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 10 }), async (expenseCount) => {
        await resetDb();
        const { userId, vehicle } = await setupUserAndVehicle();

        const generated = fc.sample(expenseArb(vehicle.id, 0, TEST_YEAR), expenseCount);
        const seededExpenses: TestExpense[] = [];
        for (let i = 0; i < generated.length; i++) {
          const e = generated[i];
          if (!e) continue;
          const expense = { ...e, id: `expense-${i}` } as TestExpense;
          await seedExpense(testDb.sql, expense);
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

async function seedExpensesForYear(
  vehicleId: string,
  year: number,
  count: number,
  prefix: string
): Promise<number> {
  const generated = fc.sample(expenseArb(vehicleId, 0, year), count);
  let total = 0;
  for (let i = 0; i < generated.length; i++) {
    const e = generated[i];
    if (!e) continue;
    const expense = { ...e, id: `${prefix}-${i}` } as TestExpense;
    await seedExpense(testDb.sql, expense);
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
          await resetDb();
          const { userId, vehicle } = await setupUserAndVehicle();

          const prevTotal = await seedExpensesForYear(
            vehicle.id,
            TEST_YEAR - 1,
            prevYearCount,
            'prev'
          );
          const currentTotal = await seedExpensesForYear(
            vehicle.id,
            TEST_YEAR,
            currentYearCount,
            'curr'
          );

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
    const { userId } = await setupUserAndVehicle();
    const result = await repo.getYearEnd(userId, TEST_YEAR);
    expect(Object.keys(result).sort()).toEqual(YEAR_END_KEYS);
  });

  test('biggestExpense/previousYearComparison are null on an empty year (not absent keys)', async () => {
    const { userId } = await setupUserAndVehicle();
    const result = await repo.getYearEnd(userId, TEST_YEAR);
    expect(result.biggestExpense).toBeNull();
    expect(result.previousYearComparison).toBeNull();
    expect(Object.hasOwn(result, 'biggestExpense')).toBe(true);
    expect(Object.hasOwn(result, 'previousYearComparison')).toBe(true);
  });
});
