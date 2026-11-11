import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import { AnalyticsRepository } from '../repository';
import {
  createTestDb,
  expenseArb,
  expenseListArb,
  seedExpense,
  seedInsurancePolicy,
  seedUser,
  seedVehicle,
  type TestDb,
  type TestExpense,
  type TestVehicle,
  vehicleArb,
  yearToRange,
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

describe('Expense sum computation', () => {
  test('YTD spending equals sum of all expense amounts for user vehicles in the given year', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 2020, max: 2025 }),
        fc.integer({ min: 1, max: 3 }).chain((vehicleCount) => {
          const vehicleArbs: fc.Arbitrary<TestVehicle>[] = [];
          for (let i = 0; i < vehicleCount; i++) {
            vehicleArbs.push(vehicleArb('user-1', i));
          }
          return fc.tuple(...vehicleArbs);
        }),
        async (targetYear, vehiclesArr) => {
          testDb.sqlite.close();
          testDb = createTestDb();
          repo = new AnalyticsRepository(testDb.drizzle);

          const user = { id: 'user-1', email: 'test@test.com', displayName: 'Test' };
          seedUser(testDb.sqlite, user);

          const vehicles: TestVehicle[] = vehiclesArr as TestVehicle[];
          for (const v of vehicles) {
            seedVehicle(testDb.sqlite, v);
          }

          const allExpenses: TestExpense[] = [];
          for (const v of vehicles) {
            const yearExpenses =
              fc.sample(
                expenseListArb(v.id, { minLength: 0, maxLength: 5, yearConstraint: targetYear }),
                1
              )[0] ?? [];
            const otherExpenses =
              fc.sample(
                expenseListArb(v.id, {
                  minLength: 0,
                  maxLength: 3,
                  yearConstraint: targetYear === 2020 ? 2021 : 2020,
                }),
                1
              )[0] ?? [];
            const renamedOther = otherExpenses.map((e, i) => ({
              ...e,
              id: `${e.id}-other-${i}`,
            }));
            allExpenses.push(...yearExpenses, ...renamedOther);
          }

          for (const e of allExpenses) {
            seedExpense(testDb.sqlite, e);
          }

          const range = yearToRange(targetYear);
          const result = await repo.getQuickStats(user.id, range);

          const expectedSum = allExpenses
            .filter((e) => e.date.getFullYear() === targetYear)
            .reduce((sum, e) => sum + e.expenseAmount, 0);

          expect(Math.abs(result.ytdSpending - expectedSum)).toBeLessThan(0.01);
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe('Vehicle count computation', () => {
  test('reported vehicle count equals the number of vehicles owned by the user', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 0, max: 5 }), async (vehicleCount) => {
        testDb.sqlite.close();
        testDb = createTestDb();
        repo = new AnalyticsRepository(testDb.drizzle);

        const user = { id: 'user-1', email: 'test@test.com', displayName: 'Test' };
        seedUser(testDb.sqlite, user);

        const otherUser = { id: 'user-2', email: 'other@test.com', displayName: 'Other' };
        seedUser(testDb.sqlite, otherUser);

        for (let i = 0; i < vehicleCount; i++) {
          const v = fc.sample(vehicleArb('user-1', i), 1)[0];
          if (v) seedVehicle(testDb.sqlite, v);
        }

        for (let i = 0; i < 2; i++) {
          const v = fc.sample(vehicleArb('user-2', i), 1)[0];
          if (v) seedVehicle(testDb.sqlite, v);
        }

        const result = await repo.getQuickStats(user.id, yearToRange(2024));

        expect(result.vehicleCount).toBe(vehicleCount);
      }),
      { numRuns: 100 }
    );
  });
});

function seedVehiclesWithExpenses(db: TestDb, vehicleCount: number, withInsurance: boolean): void {
  let policyId: string | null = null;
  if (withInsurance) {
    policyId = 'policy-1';
    seedInsurancePolicy(db.sqlite, {
      id: policyId,
      userId: 'user-1',
      company: 'Test Insurance',
      isActive: true,
    });
  }

  for (let i = 0; i < vehicleCount; i++) {
    const v: TestVehicle = {
      id: `vehicle-user-1-${i}`,
      userId: 'user-1',
      make: 'Toyota',
      model: 'Camry',
      year: 2022,
    };
    seedVehicle(db.sqlite, v);

    const expenseCount = fc.sample(fc.integer({ min: 0, max: 5 }), 1)[0] ?? 0;
    for (let j = 0; j < expenseCount; j++) {
      const exp = fc.sample(expenseArb(v.id, j, 2024), 1)[0];
      if (exp) {
        seedExpense(db.sqlite, { ...exp, category: 'maintenance' });
      }
    }
  }
}

describe('Fleet health score is bounded weighted average', () => {
  test('fleet health score is between 0 and 100 inclusive for users with vehicles', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 4 }),
        fc.boolean(),
        async (vehicleCount, withInsurance) => {
          testDb.sqlite.close();
          testDb = createTestDb();
          repo = new AnalyticsRepository(testDb.drizzle);

          const user = { id: 'user-1', email: 'test@test.com', displayName: 'Test' };
          seedUser(testDb.sqlite, user);

          seedVehiclesWithExpenses(testDb, vehicleCount, withInsurance);

          const result = await repo.getQuickStats(user.id, yearToRange(2024));

          expect(result.fleetHealthScore).toBeGreaterThanOrEqual(0);
          expect(result.fleetHealthScore).toBeLessThanOrEqual(100);
          expect(Number.isInteger(result.fleetHealthScore)).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  test('fleet health score is 0 when user has no vehicles', async () => {
    testDb.sqlite.close();
    testDb = createTestDb();
    repo = new AnalyticsRepository(testDb.drizzle);

    const user = { id: 'user-1', email: 'test@test.com', displayName: 'Test' };
    seedUser(testDb.sqlite, user);

    const result = await repo.getQuickStats(user.id, yearToRange(2024));
    expect(result.fleetHealthScore).toBe(0);
  });

  test('a vehicle with NO data scores 38 (default 50/50 + 0 insurance) and is INCLUDED in the fleet mean', async () => {
    testDb.sqlite.close();
    testDb = createTestDb();
    repo = new AnalyticsRepository(testDb.drizzle);

    const user = { id: 'user-1', email: 'test@test.com', displayName: 'Test' };
    seedUser(testDb.sqlite, user);
    seedVehicle(testDb.sqlite, {
      id: 'veh-empty',
      userId: user.id,
      make: 'Toyota',
      model: 'Camry',
      year: 2022,
    });

    const single = await repo.getQuickStats(user.id, yearToRange(2024));
    expect(single.fleetHealthScore).toBe(38);

    seedVehicle(testDb.sqlite, {
      id: 'veh-empty-2',
      userId: user.id,
      make: 'Honda',
      model: 'Civic',
      year: 2021,
    });
    const two = await repo.getQuickStats(user.id, yearToRange(2024));
    expect(two.fleetHealthScore).toBe(38);
  });
});
