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

let testDb: TestDb;
let repo: AnalyticsRepository;

beforeEach(() => {
  testDb = createTestDb();
  repo = new AnalyticsRepository(testDb.drizzle);
});

afterEach(() => {
  testDb.sqlite.close();
});

function fuelExpenseArb(vehicleId: string, index: number, year: number): fc.Arbitrary<TestExpense> {
  const minTs = new Date(year, 0, 2).getTime();
  const maxTs = new Date(year, 11, 30).getTime();

  return fc.record({
    id: fc.constant(`fuel-${vehicleId}-${index}`),
    vehicleId: fc.constant(vehicleId),
    category: fc.constant('fuel' as string),
    expenseAmount: fc.double({ min: 5, max: 200, noNaN: true, noDefaultInfinity: true }),
    date: fc.integer({ min: minTs, max: maxTs }).map((ts) => new Date(ts)),
    mileage: fc.constant(null as number | null),
    volume: fc.double({ min: 1, max: 30, noNaN: true, noDefaultInfinity: true }),
    fuelType: fc.constantFrom('Regular', 'Premium', 'Diesel'),
    missedFillup: fc.constant(false),
  });
}

describe('Fuel volume ordering invariant', () => {
  test('fillupDetails.minVolume <= fillupDetails.avgVolume <= fillupDetails.maxVolume', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 8 }), async (expenseCount) => {
        testDb.sqlite.close();
        testDb = createTestDb();
        repo = new AnalyticsRepository(testDb.drizzle);

        const user = { id: 'user-1', email: 'test@test.com', displayName: 'Test' };
        seedUser(testDb.sqlite, user);

        const vehicle: TestVehicle = {
          id: 'vehicle-user-1-0',
          userId: 'user-1',
          make: 'Toyota',
          model: 'Camry',
          year: 2022,
        };
        seedVehicle(testDb.sqlite, vehicle);

        const expensesArr =
          fc.sample(
            fc.array(fuelExpenseArb(vehicle.id, 0, 2024), {
              minLength: expenseCount,
              maxLength: expenseCount,
            }),
            1
          )[0] ?? [];

        const uniqueExpenses = expensesArr.map((e, i) => ({
          ...e,
          id: `fuel-${vehicle.id}-${i}`,
        }));

        for (const e of uniqueExpenses) {
          seedExpense(testDb.sqlite, e);
        }

        const result = await repo.getFuelStats(user.id, yearToRange(2024));

        if (
          result.fillupDetails.minVolume != null &&
          result.fillupDetails.avgVolume != null &&
          result.fillupDetails.maxVolume != null
        ) {
          expect(result.fillupDetails.minVolume).toBeLessThanOrEqual(
            result.fillupDetails.avgVolume
          );
          expect(result.fillupDetails.avgVolume).toBeLessThanOrEqual(
            result.fillupDetails.maxVolume
          );
        }
      }),
      { numRuns: 100 }
    );
  });
});

describe('MPG computation from consecutive expenses', () => {
  test('MPG equals (currentMileage - previousMileage) / volume for consecutive fuel expenses', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 10000, max: 50000 }),
        fc.integer({ min: 100, max: 500 }),
        fc.double({ min: 5, max: 25, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: 10, max: 100, noNaN: true, noDefaultInfinity: true }),
        async (startMileage, milesDriven, volume, expenseAmount) => {
          testDb.sqlite.close();
          testDb = createTestDb();
          repo = new AnalyticsRepository(testDb.drizzle);

          const user = { id: 'user-1', email: 'test@test.com', displayName: 'Test' };
          seedUser(testDb.sqlite, user);

          const vehicle: TestVehicle = {
            id: 'vehicle-user-1-0',
            userId: 'user-1',
            make: 'Toyota',
            model: 'Camry',
            year: 2022,
          };
          seedVehicle(testDb.sqlite, vehicle);

          const endMileage = startMileage + milesDriven;
          const expectedMpg = milesDriven / volume;

          if (expectedMpg < 5 || expectedMpg > 100) return;
          if (milesDriven > 1000) return;

          const expense1: TestExpense = {
            id: 'fuel-prev',
            vehicleId: vehicle.id,
            category: 'fuel',
            expenseAmount: 40,
            date: new Date(2024, 3, 1),
            mileage: startMileage,
            volume: 10,
            fuelType: 'Regular',
            missedFillup: false,
          };

          const expense2: TestExpense = {
            id: 'fuel-curr',
            vehicleId: vehicle.id,
            category: 'fuel',
            expenseAmount,
            date: new Date(2024, 3, 15),
            mileage: endMileage,
            volume,
            fuelType: 'Regular',
            missedFillup: false,
          };

          seedExpense(testDb.sqlite, expense1);
          seedExpense(testDb.sqlite, expense2);

          const result = await repo.getFuelStats(user.id, yearToRange(2024));

          if (result.fuelConsumption.avgEfficiency != null) {
            expect(Math.abs(result.fuelConsumption.avgEfficiency - expectedMpg)).toBeLessThan(0.01);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe('Monthly arrays bounded to 12 entries', () => {
  test('monthlyConsumption has at most 12 entries', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 20 }), async (expenseCount) => {
        testDb.sqlite.close();
        testDb = createTestDb();
        repo = new AnalyticsRepository(testDb.drizzle);

        const user = { id: 'user-1', email: 'test@test.com', displayName: 'Test' };
        seedUser(testDb.sqlite, user);

        const vehicle: TestVehicle = {
          id: 'vehicle-user-1-0',
          userId: 'user-1',
          make: 'Toyota',
          model: 'Camry',
          year: 2022,
        };
        seedVehicle(testDb.sqlite, vehicle);

        for (let i = 0; i < expenseCount; i++) {
          const month = i % 12;
          const expense: TestExpense = {
            id: `fuel-${i}`,
            vehicleId: vehicle.id,
            category: 'fuel',
            expenseAmount: 40 + i,
            date: new Date(2024, month, 10 + (i % 15)),
            mileage: 10000 + i * 300,
            volume: 8 + (i % 10),
            fuelType: 'Regular',
            missedFillup: false,
          };
          seedExpense(testDb.sqlite, expense);
        }

        const result = await repo.getFuelStats(user.id, yearToRange(2024));

        expect(result.monthlyConsumption.length).toBeLessThanOrEqual(12);
      }),
      { numRuns: 100 }
    );
  });
});

describe('total distance is summed per vehicle across multiple vehicles', () => {
  test('two vehicles in disjoint odometer ranges sum per-car distance, not pooled max-min', async () => {
    const user = { id: 'user-1', email: 'test@test.com', displayName: 'Test' };
    seedUser(testDb.sqlite, user);

    const carA: TestVehicle = {
      id: 'veh-A',
      userId: user.id,
      make: 'Toyota',
      model: 'Camry',
      year: 2022,
    };
    const carB: TestVehicle = {
      id: 'veh-B',
      userId: user.id,
      make: 'Honda',
      model: 'Civic',
      year: 2021,
    };
    seedVehicle(testDb.sqlite, carA);
    seedVehicle(testDb.sqlite, carB);

    const rows: TestExpense[] = [
      {
        id: 'a1',
        vehicleId: 'veh-A',
        category: 'fuel',
        expenseAmount: 40,
        date: new Date(2024, 0, 5),
        mileage: 10000,
        volume: 10,
        fuelType: 'Regular',
        missedFillup: false,
      },
      {
        id: 'a2',
        vehicleId: 'veh-A',
        category: 'fuel',
        expenseAmount: 42,
        date: new Date(2024, 1, 5),
        mileage: 11000,
        volume: 11,
        fuelType: 'Regular',
        missedFillup: false,
      },
      {
        id: 'b1',
        vehicleId: 'veh-B',
        category: 'fuel',
        expenseAmount: 38,
        date: new Date(2024, 0, 6),
        mileage: 90000,
        volume: 9,
        fuelType: 'Regular',
        missedFillup: false,
      },
      {
        id: 'b2',
        vehicleId: 'veh-B',
        category: 'fuel',
        expenseAmount: 39,
        date: new Date(2024, 1, 6),
        mileage: 90500,
        volume: 9,
        fuelType: 'Regular',
        missedFillup: false,
      },
    ];
    for (const r of rows) seedExpense(testDb.sqlite, r);

    const result = await repo.getFuelStats(user.id, yearToRange(2024));

    expect(result.distance.totalDistance).toBe(1500);
  });
});

describe('cross-fleet fillup count excludes split siblings', () => {
  test('a split fuel expense (volume-null siblings) counts as zero fillups, not N', async () => {
    const user = { id: 'user-1', email: 'test@test.com', displayName: 'Test' };
    seedUser(testDb.sqlite, user);

    const carA: TestVehicle = {
      id: 'veh-A',
      userId: user.id,
      make: 'Toyota',
      model: 'Camry',
      year: 2022,
    };
    const carB: TestVehicle = {
      id: 'veh-B',
      userId: user.id,
      make: 'Honda',
      model: 'Civic',
      year: 2021,
    };
    seedVehicle(testDb.sqlite, carA);
    seedVehicle(testDb.sqlite, carB);

    const realFillups: TestExpense[] = [
      {
        id: 'real-A',
        vehicleId: 'veh-A',
        category: 'fuel',
        expenseAmount: 40,
        date: new Date(2024, 2, 10),
        mileage: 10000,
        volume: 10,
        fuelType: 'Regular',
        missedFillup: false,
      },
      {
        id: 'real-B',
        vehicleId: 'veh-B',
        category: 'fuel',
        expenseAmount: 38,
        date: new Date(2024, 2, 12),
        mileage: 90000,
        volume: 9,
        fuelType: 'Regular',
        missedFillup: false,
      },
    ];

    const splitSiblings: TestExpense[] = [
      {
        id: 'split-A',
        vehicleId: 'veh-A',
        category: 'fuel',
        expenseAmount: 12.5,
        date: new Date(2024, 4, 1),
        mileage: null,
        volume: null,
        fuelType: null,
        missedFillup: false,
      },
      {
        id: 'split-B',
        vehicleId: 'veh-B',
        category: 'fuel',
        expenseAmount: 12.5,
        date: new Date(2024, 4, 1),
        mileage: null,
        volume: null,
        fuelType: null,
        missedFillup: false,
      },
    ];

    for (const r of [...realFillups, ...splitSiblings]) seedExpense(testDb.sqlite, r);

    const result = await repo.getFuelStats(user.id, yearToRange(2024));

    expect(result.fillups.currentYear).toBe(2);
    expect(result.volume.currentYear).toBe(19);
  });
});

describe('Gas price always positive', () => {
  test('all gasPriceHistory entries have positive pricePerVolume', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 10 }), async (expenseCount) => {
        testDb.sqlite.close();
        testDb = createTestDb();
        repo = new AnalyticsRepository(testDb.drizzle);

        const user = { id: 'user-1', email: 'test@test.com', displayName: 'Test' };
        seedUser(testDb.sqlite, user);

        const vehicle: TestVehicle = {
          id: 'vehicle-user-1-0',
          userId: 'user-1',
          make: 'Toyota',
          model: 'Camry',
          year: 2022,
        };
        seedVehicle(testDb.sqlite, vehicle);

        const expensesArr =
          fc.sample(
            fc.array(fuelExpenseArb(vehicle.id, 0, 2024), {
              minLength: expenseCount,
              maxLength: expenseCount,
            }),
            1
          )[0] ?? [];

        const uniqueExpenses = expensesArr.map((e, i) => ({
          ...e,
          id: `fuel-${vehicle.id}-${i}`,
        }));

        for (const e of uniqueExpenses) {
          seedExpense(testDb.sqlite, e);
        }

        const result = await repo.getFuelStats(user.id, yearToRange(2024));

        for (const entry of result.gasPriceHistory) {
          expect(entry.pricePerVolume).toBeGreaterThan(0);
        }
      }),
      { numRuns: 100 }
    );
  });
});

describe('monthlyConsumption keeps the most recent 12 months', () => {
  test('with 14 months of fill-ups, returns 2023-03 .. 2024-02', async () => {
    seedUser(testDb.sqlite, { id: 'user-1', email: 'test@test.com', displayName: 'Test' });
    seedVehicle(testDb.sqlite, {
      id: 'vehicle-1',
      userId: 'user-1',
      make: 'Toyota',
      model: 'Camry',
      year: 2022,
    });
    for (let i = 0; i < 14; i++) {
      seedExpense(testDb.sqlite, {
        id: `fuel-${i}`,
        vehicleId: 'vehicle-1',
        category: 'fuel',
        expenseAmount: 40,
        date: new Date(2023 + Math.floor(i / 12), i % 12, 10),
        mileage: 10000 + i * 300,
        volume: 10,
        fuelType: 'Regular',
        missedFillup: false,
      });
    }

    const range = { start: yearToRange(2023).start, end: yearToRange(2024).end };
    const months = (await repo.getFuelStats('user-1', range)).monthlyConsumption.map(
      (m) => m.month
    );

    expect(months).toHaveLength(12);
    expect(months[0]).toBe('2023-03');
    expect(months.at(-1)).toBe('2024-02');
  });
});
