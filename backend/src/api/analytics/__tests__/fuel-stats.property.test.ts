/**
 * Property-Based Tests for Fuel Stats Computation
 *
 * Property 16: Fuel volume ordering invariant
 * For any non-empty set of fuel expenses, fillupDetails.minVolume <= fillupDetails.avgVolume <= fillupDetails.maxVolume.
 *
 * Property 17: MPG computation from consecutive expenses
 * For any pair of consecutive fuel expenses with valid mileage readings,
 * MPG should equal (currentMileage - previousMileage) / fuelAmount.
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
// Generator: fuel expenses with guaranteed positive fuelAmount
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
    fuelAmount: fc.double({ min: 1, max: 30, noNaN: true, noDefaultInfinity: true }),
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
          currentInsurancePolicyId: null,
        };
        seedVehicle(testDb.sqlite, vehicle);

        // Generate fuel expenses with positive fuelAmount
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
      { numRuns: 200 }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 17: MPG computation from consecutive expenses
// **Validates: Requirement 4.5**
// ---------------------------------------------------------------------------
describe('Property 17: MPG computation from consecutive expenses', () => {
  test('MPG equals (currentMileage - previousMileage) / fuelAmount for consecutive fuel expenses', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 10000, max: 50000 }),
        fc.integer({ min: 100, max: 500 }),
        fc.double({ min: 5, max: 25, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: 10, max: 100, noNaN: true, noDefaultInfinity: true }),
        async (startMileage, milesDriven, fuelAmount, expenseAmount) => {
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
            currentInsurancePolicyId: null,
          };
          seedVehicle(testDb.sqlite, vehicle);

          const endMileage = startMileage + milesDriven;
          const expectedMpg = milesDriven / fuelAmount;

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
            fuelAmount: 10,
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
            fuelAmount,
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
      { numRuns: 200 }
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
          currentInsurancePolicyId: null,
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
            fuelAmount: 8 + (i % 10),
            fuelType: 'Regular',
            missedFillup: false,
          };
          seedExpense(testDb.sqlite, expense);
        }

        const result = await repo.getFuelStats(user.id, yearToRange(2024));

        expect(result.monthlyConsumption.length).toBeLessThanOrEqual(12);
      }),
      { numRuns: 200 }
    );
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
          currentInsurancePolicyId: null,
        };
        seedVehicle(testDb.sqlite, vehicle);

        // Generate fuel expenses with positive amounts and fuelAmount
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
      { numRuns: 200 }
    );
  });
});
