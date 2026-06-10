/**
 * Property-Based Tests for Fuel Stats Computation
 *
 * Property 16: Fuel volume ordering invariant
 * For any non-empty set of fuel expenses, fillupDetails.minVolume <= fillupDetails.avgVolume <= fillupDetails.maxVolume.
 *
 * Property 17: MPG computation from consecutive expenses
 * For any pair of consecutive fuel expenses with valid mileage readings,
 * MPG should equal (currentMileage - previousMileage) / volume.
 *
 * Property 8: Monthly arrays bounded to 12 entries
 * For any analytics response containing monthly data arrays, the array should contain at most 12 entries.
 *
 * Property 18: Gas price always positive
 * For any fuel expense in the gas price history, the price per gallon should be a positive number.
 *
 * **Validates: Requirements 4.4, 4.5, 4.6, 4.7, 12.7**
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
// Generator: fuel expenses with guaranteed positive volume
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Property 16: Fuel volume ordering invariant
// **Validates: Requirement 4.4**
// ---------------------------------------------------------------------------
describe('Property 16: Fuel volume ordering invariant', () => {
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

        // Generate fuel expenses with positive volume
        const expensesArr =
          fc.sample(
            fc.array(fuelExpenseArb(vehicle.id, 0, 2024), {
              minLength: expenseCount,
              maxLength: expenseCount,
            }),
            1
          )[0] ?? [];

        // Ensure unique IDs
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

// ---------------------------------------------------------------------------
// Property 17: MPG computation from consecutive expenses
// **Validates: Requirement 4.5**
// ---------------------------------------------------------------------------
describe('Property 17: MPG computation from consecutive expenses', () => {
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

          // Skip unrealistic MPG values that the filter would reject
          if (expectedMpg < 5 || expectedMpg > 100) return;
          // Skip if miles driven exceeds the max reasonable threshold
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

          // The avgEfficiency should equal the computed efficiency since there's only one pair
          if (result.fuelConsumption.avgEfficiency != null) {
            expect(Math.abs(result.fuelConsumption.avgEfficiency - expectedMpg)).toBeLessThan(0.01);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 8: Monthly arrays bounded to 12 entries
// **Validates: Requirements 4.6, 12.7**
// ---------------------------------------------------------------------------
describe('Property 8: Monthly arrays bounded to 12 entries', () => {
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

        // Generate fuel expenses spread across the year
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

// ---------------------------------------------------------------------------
// Regression (cycle 211): total distance is summed PER VEHICLE, not pooled.
//
// buildFuelStatsFromData previously did Math.max(allMileages) - Math.min(allMileages)
// over EVERY vehicle's readings. For a user with two cars at different odometer ranges
// (e.g. one at 12k mi, one at 95k mi) that returned ~83k — a garbage "distance driven"
// on the dashboard summary. The fix groups by vehicle, computes max-min per car, and
// sums. This pins that contract with a deterministic two-vehicle fixture.
// ---------------------------------------------------------------------------
describe('total distance is summed per vehicle (cycle 211 multi-vehicle regression)', () => {
  test('two vehicles in disjoint odometer ranges sum per-car distance, not pooled max-min', async () => {
    const user = { id: 'user-1', email: 'test@test.com', displayName: 'Test' };
    seedUser(testDb.sqlite, user);

    // Car A: low odometer band (10,000 -> 11,000 = 1,000 driven).
    // Car B: high odometer band (90,000 -> 90,500 = 500 driven).
    // Correct total = 1,500. Pooled max-min would be 90,500 - 10,000 = 80,500.
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

    // Per-vehicle sum: (11000-10000) + (90500-90000) = 1500. NOT the pooled 80500.
    expect(result.distance.totalDistance).toBe(1500);
  });
});

// ---------------------------------------------------------------------------
// Regression (C97, bug #18): cross-fleet fillup COUNT must not be inflated by a
// split fuel expense.
//
// A fuel expense split across N vehicles creates N sibling rows, but only the AMOUNT
// is split — siblings carry volume=null (ExpenseSplitService.createSiblings). The
// cross-fleet getFuelStats (no vehicleId) sees all siblings, so counting raw rows
// (fuelRows.length) reported one logical fillup as N. A "fillup" is a fuel PURCHASE
// with an actual volume, so the count now includes only volume-bearing rows. The
// volume/cost SUMS were always correct (null volume contributes 0); only the COUNT
// was wrong. This pins: two real fillups (volume set) + two split siblings (volume
// null) on different cars => currentYear fillups == 2, not 4; gallons unchanged.
// ---------------------------------------------------------------------------
describe('cross-fleet fillup count excludes split siblings (C97 bug #18)', () => {
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

    // Two genuine fillups (one per car) — each carries a real volume.
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

    // One fuel expense split across both cars => two sibling rows, AMOUNT split but
    // volume=null on each (exactly what ExpenseSplitService.createSiblings produces).
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

    // Cross-fleet view (no vehicleId) — the path where all siblings are visible.
    const result = await repo.getFuelStats(user.id, yearToRange(2024));

    // Two real fillups; the two volume-null split siblings are NOT fillups.
    // Pre-fix this was 4 (raw fuelRows.length).
    expect(result.fillups.currentYear).toBe(2);
    // The gallons SUM was always correct — null volume contributes nothing.
    expect(result.volume.currentYear).toBe(19);
  });
});

// ---------------------------------------------------------------------------
// Property 18: Gas price always positive
// **Validates: Requirement 4.7**
// ---------------------------------------------------------------------------
describe('Property 18: Gas price always positive', () => {
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

        // Generate fuel expenses with positive amounts and volume
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
