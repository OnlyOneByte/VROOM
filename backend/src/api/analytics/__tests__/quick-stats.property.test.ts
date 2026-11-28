import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import { AnalyticsRepository } from '../repository';
import {
  type AnalyticsTestDb,
  openAnalyticsTestDb,
  seedExpense,
  seedInsurancePolicy,
  seedInsuranceTermVehicle,
  seedUser,
  seedVehicle,
} from './analytics-test-db';
import {
  expenseArb,
  expenseListArb,
  type TestExpense,
  type TestVehicle,
  vehicleArb,
  yearToRange,
} from './analytics-test-generators';

let testDb: AnalyticsTestDb;
let repo: AnalyticsRepository;

beforeEach(async () => {
  testDb = await openAnalyticsTestDb();
  repo = new AnalyticsRepository(testDb.asyncDb);
});

afterEach(() => {
  testDb.close();
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
          testDb.close();
          testDb = await openAnalyticsTestDb();
          repo = new AnalyticsRepository(testDb.asyncDb);

          const user = { id: 'user-1', email: 'test@test.com', displayName: 'Test' };
          await seedUser(testDb.sql, user);

          const vehicles: TestVehicle[] = vehiclesArr as TestVehicle[];
          for (const v of vehicles) {
            await seedVehicle(testDb.sql, v);
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
            await seedExpense(testDb.sql, e);
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
        testDb.close();
        testDb = await openAnalyticsTestDb();
        repo = new AnalyticsRepository(testDb.asyncDb);

        const user = { id: 'user-1', email: 'test@test.com', displayName: 'Test' };
        await seedUser(testDb.sql, user);

        const otherUser = { id: 'user-2', email: 'other@test.com', displayName: 'Other' };
        await seedUser(testDb.sql, otherUser);

        for (let i = 0; i < vehicleCount; i++) {
          const v = fc.sample(vehicleArb('user-1', i), 1)[0];
          if (v) await seedVehicle(testDb.sql, v);
        }

        for (let i = 0; i < 2; i++) {
          const v = fc.sample(vehicleArb('user-2', i), 1)[0];
          if (v) await seedVehicle(testDb.sql, v);
        }

        const result = await repo.getQuickStats(user.id, yearToRange(2024));

        expect(result.vehicleCount).toBe(vehicleCount);
      }),
      { numRuns: 100 }
    );
  });
});

async function seedVehiclesWithExpenses(
  db: AnalyticsTestDb,
  vehicleCount: number,
  withInsurance: boolean
): Promise<void> {
  let policyId: string | null = null;
  if (withInsurance) {
    policyId = 'policy-1';
    await seedInsurancePolicy(db.sql, {
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
    await seedVehicle(db.sql, v);

    const expenseCount = fc.sample(fc.integer({ min: 0, max: 5 }), 1)[0] ?? 0;
    for (let j = 0; j < expenseCount; j++) {
      const exp = fc.sample(expenseArb(v.id, j, 2024), 1)[0];
      if (exp) {
        await seedExpense(db.sql, { ...exp, category: 'maintenance' });
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
          testDb.close();
          testDb = await openAnalyticsTestDb();
          repo = new AnalyticsRepository(testDb.asyncDb);

          const user = { id: 'user-1', email: 'test@test.com', displayName: 'Test' };
          await seedUser(testDb.sql, user);

          await seedVehiclesWithExpenses(testDb, vehicleCount, withInsurance);

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
    testDb.close();
    testDb = await openAnalyticsTestDb();
    repo = new AnalyticsRepository(testDb.asyncDb);

    const user = { id: 'user-1', email: 'test@test.com', displayName: 'Test' };
    await seedUser(testDb.sql, user);

    const result = await repo.getQuickStats(user.id, yearToRange(2024));
    expect(result.fleetHealthScore).toBe(0);
  });

  test('a vehicle with NO data scores 38 (default 50/50 + 0 insurance) and is INCLUDED in the fleet mean', async () => {
    testDb.close();
    testDb = await openAnalyticsTestDb();
    repo = new AnalyticsRepository(testDb.asyncDb);

    const user = { id: 'user-1', email: 'test@test.com', displayName: 'Test' };
    await seedUser(testDb.sql, user);
    await seedVehicle(testDb.sql, {
      id: 'veh-empty',
      userId: user.id,
      make: 'Toyota',
      model: 'Camry',
      year: 2022,
    });

    const single = await repo.getQuickStats(user.id, yearToRange(2024));
    expect(single.fleetHealthScore).toBe(38);

    await seedVehicle(testDb.sql, {
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

describe('YTD spending counts only the year the range ends in', () => {
  test('a trailing 12-month window across Jan 1 sums only the new year', async () => {
    testDb.close();
    testDb = await openAnalyticsTestDb();
    repo = new AnalyticsRepository(testDb.asyncDb);
    await seedUser(testDb.sql, { id: 'user-1', email: 'test@test.com', displayName: 'Test' });
    await seedVehicle(testDb.sql, {
      id: 'veh-1',
      userId: 'user-1',
      make: 'Toyota',
      model: 'Camry',
      year: 2022,
    });
    const expense = (id: string, date: Date, expenseAmount: number): TestExpense => ({
      id,
      vehicleId: 'veh-1',
      category: 'maintenance',
      expenseAmount,
      date,
      mileage: null,
      volume: null,
      fuelType: null,
      missedFillup: false,
    });
    await seedExpense(
      testDb.sql,
      expense('last-year', new Date(Date.UTC(2024, 11, 20, 12)), 30000)
    );
    await seedExpense(testDb.sql, expense('this-year', new Date(Date.UTC(2025, 0, 10, 12)), 4500));

    const trailing = {
      start: Math.floor(Date.UTC(2024, 1, 1) / 1000),
      end: Math.floor(Date.UTC(2025, 1, 1) / 1000),
    };
    const result = await repo.getQuickStats('user-1', trailing);
    expect(result.ytdSpending).toBe(4500);

    const summary = await repo.getSummary('user-1', trailing);
    expect(summary.quickStats.ytdSpending).toBe(4500);
  });

  test("the client's local Jan 1 (ytdStart) decides the year at either edge of UTC", async () => {
    testDb.close();
    testDb = await openAnalyticsTestDb();
    repo = new AnalyticsRepository(testDb.asyncDb);
    await seedUser(testDb.sql, { id: 'user-1', email: 'test@test.com', displayName: 'Test' });
    await seedVehicle(testDb.sql, {
      id: 'veh-1',
      userId: 'user-1',
      make: 'Toyota',
      model: 'Camry',
      year: 2022,
    });
    const seed = async (id: string, iso: string, expenseAmount: number) =>
      await seedExpense(testDb.sql, {
        id,
        vehicleId: 'veh-1',
        category: 'maintenance',
        expenseAmount,
        date: new Date(iso),
        mileage: null,
        volume: null,
        fuelType: null,
        missedFillup: false,
      });
    const seconds = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);

    await seed('ny-dec31-noon', '2024-12-31T17:00:00.000Z', 1200);
    await seed('ny-last-year', '2023-12-31T17:00:00.000Z', 99);
    const newYorkDec31 = {
      start: seconds('2023-12-31T05:00:00.000Z'),
      end: seconds('2025-01-01T05:00:00.000Z'),
    };
    const ny = await repo.getQuickStats(
      'user-1',
      newYorkDec31,
      seconds('2024-01-01T05:00:00.000Z')
    );
    expect(ny.ytdSpending).toBe(1200);

    await testDb.sql.run("DELETE FROM expenses WHERE id IN ('ny-dec31-noon', 'ny-last-year')");
    await seed('akl-jan1-noon', '2024-12-31T23:00:00.000Z', 800);
    await seed('akl-last-year', '2024-06-15T00:00:00.000Z', 99);
    const aucklandJan1 = {
      start: seconds('2023-12-31T11:00:00.000Z'),
      end: seconds('2025-01-01T11:00:00.000Z'),
    };
    const akl = await repo.getSummary('user-1', aucklandJan1, seconds('2024-12-31T11:00:00.000Z'));
    expect(akl.quickStats.ytdSpending).toBe(800);
  });
});

describe('fleet health counts insurance only while a covering term is current', () => {
  const DAY_MS = 24 * 60 * 60 * 1000;

  async function seedCoveredVehicle(termStart: number, termEnd: number): Promise<void> {
    await seedUser(testDb.sql, { id: 'user-1', email: 'test@test.com', displayName: 'Test' });
    await seedVehicle(testDb.sql, {
      id: 'veh-1',
      userId: 'user-1',
      make: 'Toyota',
      model: 'Camry',
      year: 2022,
    });
    await seedInsurancePolicy(testDb.sql, {
      id: 'pol-1',
      userId: 'user-1',
      company: 'State Farm',
      isActive: true,
    });
    await testDb.sql.run(
      'INSERT INTO insurance_terms (id, policy_id, start_date, end_date) VALUES (?, ?, ?, ?)',
      ['term-1', 'pol-1', Math.floor(termStart / 1000), Math.floor(termEnd / 1000)]
    );
    await seedInsuranceTermVehicle(testDb.sql, { termId: 'term-1', vehicleId: 'veh-1' });
  }

  test('a current term adds the 25-point insurance share', async () => {
    testDb.close();
    testDb = await openAnalyticsTestDb();
    repo = new AnalyticsRepository(testDb.asyncDb);
    await seedCoveredVehicle(Date.now() - 30 * DAY_MS, Date.now() + 150 * DAY_MS);

    const result = await repo.getQuickStats('user-1', yearToRange(2024));
    expect(result.fleetHealthScore).toBe(63);
  });

  test('an expired term on a policy still flagged active adds nothing', async () => {
    testDb.close();
    testDb = await openAnalyticsTestDb();
    repo = new AnalyticsRepository(testDb.asyncDb);
    await seedCoveredVehicle(Date.UTC(2024, 0, 1), Date.UTC(2024, 5, 30));

    const result = await repo.getQuickStats('user-1', yearToRange(2024));
    expect(result.fleetHealthScore).toBe(38);
  });
});
