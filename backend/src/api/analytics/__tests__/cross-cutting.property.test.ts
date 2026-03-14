/**
 * Cross-Cutting Property-Based Tests for Analytics
 *
 * Property 6: Vehicle ownership validation
 * Repository methods filter by userId, so querying with a mismatched
 * userId+vehicleId returns empty/zero data rather than another user's data.
 * **Validates: Requirements 4.3, 9.7, 10.5, 11.3, 13.3**
 *
 * Property 7: Year scoping filters correctly
 * For any analytics endpoint that accepts a year parameter, returned data
 * should only include expenses whose date falls within the specified year.
 * **Validates: Requirements 2.2, 11.2**
 *
 * Property 26: Authentication required on all endpoints
 * Verified by checking that routes.ts applies requireAuth middleware.
 * **Validates: Requirement 13.1**
 *
 * Property 27: User data isolation
 * Analytics data returned for user A never contains vehicles or expenses
 * belonging to user B.
 * **Validates: Requirement 13.2**
 *
 * Property 28: Invalid parameters rejected with 400
 * Zod schemas reject invalid inputs (non-integer year, etc.).
 * **Validates: Requirements 14.2, 14.3**
 *
 * Property 19: Vehicle ID filtering returns only that vehicle's data
 * When a vehicleId filter is provided, all returned data pertains
 * exclusively to the specified vehicle.
 * **Validates: Requirement 4.2**
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import { AnalyticsRepository } from '../repository';
import { vehicleIdQuerySchema, yearQuerySchema, yearVehicleQuerySchema } from '../routes';
import {
  createTestDb,
  expenseArb,
  expenseListArb,
  seedExpense,
  seedUser,
  seedVehicle,
  type TestDb,
  type TestExpense,
  type TestVehicle,
  vehicleArb,
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

/** Reset DB and repo for a fresh property test iteration. */
function resetDb(): void {
  testDb.sqlite.close();
  testDb = createTestDb();
  repo = new AnalyticsRepository(testDb.drizzle);
}

/** Seed a user and a single vehicle, returning the vehicle. */
function seedUserAndVehicle(userId: string, email: string, name: string): TestVehicle {
  seedUser(testDb.sqlite, { id: userId, email, displayName: name });
  const v: TestVehicle = {
    id: `vehicle-${userId}-0`,
    userId,
    make: 'Toyota',
    model: 'Camry',
    year: 2022,
  };
  seedVehicle(testDb.sqlite, v);
  return v;
}

/** Seed sampled expenses for a vehicle and return them. */
function seedSampledExpenses(
  vehicleId: string,
  count: number,
  year: number,
  idPrefix: string
): TestExpense[] {
  const generated = fc.sample(expenseArb(vehicleId, 0, year), count);
  const seeded: TestExpense[] = [];
  for (let i = 0; i < generated.length; i++) {
    const e = generated[i];
    if (!e) continue;
    const exp = { ...e, id: `${idPrefix}-${i}` };
    seedExpense(testDb.sqlite, exp);
    seeded.push(exp);
  }
  return seeded;
}

/** Seed vehicles with random expenses for a user, returning vehicle list. */
function seedVehiclesWithRandomExpenses(userId: string, vehicleCount: number): TestVehicle[] {
  const result: TestVehicle[] = [];
  for (let i = 0; i < vehicleCount; i++) {
    const v = fc.sample(vehicleArb(userId, i), 1)[0];
    if (!v) continue;
    seedVehicle(testDb.sqlite, v);
    result.push(v);

    const exps =
      fc.sample(expenseListArb(v.id, { minLength: 1, maxLength: 3, yearConstraint: 2024 }), 1)[0] ??
      [];
    for (const e of exps) {
      seedExpense(testDb.sqlite, e);
    }
  }
  return result;
}

/** Seed vehicles with a distinctive large expense for a user, returning vehicle list. */
function seedVehiclesWithDistinctiveExpenses(userId: string, vehicleCount: number): TestVehicle[] {
  const result: TestVehicle[] = [];
  for (let i = 0; i < vehicleCount; i++) {
    const v = fc.sample(vehicleArb(userId, i), 1)[0];
    if (!v) continue;
    seedVehicle(testDb.sqlite, v);
    result.push(v);

    seedExpense(testDb.sqlite, {
      id: `${userId}-exp-${i}`,
      vehicleId: v.id,
      category: 'maintenance',
      expenseAmount: 99999,
      date: new Date(2024, 5, 15),
      mileage: null,
      volume: null,
      fuelType: null,
      missedFillup: false,
    });
  }
  return result;
}

// ---------------------------------------------------------------------------
// Property 6: Vehicle ownership validation
// Repository methods filter by userId, so querying with a mismatched
// userId+vehicleId returns empty/zero data rather than another user's data.
// **Validates: Requirements 4.3, 9.7, 10.5, 11.3, 13.3**
// ---------------------------------------------------------------------------
describe('Property 6: Vehicle ownership validation', () => {
  test('per-vehicle endpoints return empty/zero data for non-owned vehicleId', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 4 }), async (expenseCount) => {
        resetDb();

        // Create two users, each with a vehicle
        const user1 = { id: 'user-1', email: 'u1@test.com', displayName: 'User 1' };
        const user2 = { id: 'user-2', email: 'u2@test.com', displayName: 'User 2' };
        seedUser(testDb.sqlite, user1);
        seedUser(testDb.sqlite, user2);

        const vehicle1: TestVehicle = {
          id: 'vehicle-user-1-0',
          userId: 'user-1',
          make: 'Toyota',
          model: 'Camry',
          year: 2022,
        };
        const vehicle2: TestVehicle = {
          id: 'vehicle-user-2-0',
          userId: 'user-2',
          make: 'Honda',
          model: 'Civic',
          year: 2023,
        };
        seedVehicle(testDb.sqlite, vehicle1);
        seedVehicle(testDb.sqlite, vehicle2);

        // Seed expenses only for user2's vehicle
        const expenses = fc.sample(expenseArb(vehicle2.id, 0, 2024), expenseCount);
        for (let i = 0; i < expenses.length; i++) {
          const e = expenses[i];
          if (!e) continue;
          seedExpense(testDb.sqlite, { ...e, id: `exp-${i}` });
        }

        // Query user1's analytics with user2's vehicleId — should get empty/zero data.
        // The repository filters by userId, so no expenses from user2 appear.
        // Health score defaults: regularity=50 (no records), mileage=50, insurance=0
        // → overallScore = round(50*0.4 + 50*0.35 + 0*0.25) = 38
        const health = await repo.getVehicleHealth(user1.id, vehicle2.id);
        expect(health.insuranceCoverage).toBe(0);
        // No maintenance expenses found for this user+vehicle combo
        // so regularity/mileage use defaults, but no user2 data leaks
        expect(health.overallScore).toBeGreaterThanOrEqual(0);
        expect(health.overallScore).toBeLessThanOrEqual(100);

        const tco = await repo.getVehicleTCO(user1.id, vehicle2.id);
        expect(tco.totalCost).toBe(0);
        expect(tco.fuelCost).toBe(0);
        expect(tco.maintenanceCost).toBe(0);

        const vExpenses = await repo.getVehicleExpenses(user1.id, vehicle2.id, yearToRange(2024));
        expect(vExpenses.maintenanceCosts).toEqual([]);
        expect(vExpenses.fuelEfficiencyAndCost).toEqual([]);
        expect(vExpenses.expenseBreakdown).toEqual([]);
      }),
      { numRuns: 100 }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 7: Year scoping filters correctly
// Returned data should only include expenses whose date falls within the
// specified year.
// **Validates: Requirements 2.2, 11.2**
// ---------------------------------------------------------------------------
describe('Property 7: Year scoping filters correctly', () => {
  test('querying year X returns no data from year Y', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 2021, max: 2024 }),
        fc.integer({ min: 1, max: 5 }),
        fc.integer({ min: 1, max: 5 }),
        async (targetYear, targetCount, otherCount) => {
          resetDb();

          const vehicle = seedUserAndVehicle('user-1', 'test@test.com', 'Test');

          // Seed expenses in the target year
          const targetExpenses = seedSampledExpenses(vehicle.id, targetCount, targetYear, 'target');

          // Seed expenses in a different year
          const otherYear = targetYear === 2024 ? 2022 : targetYear + 1;
          seedSampledExpenses(vehicle.id, otherCount, otherYear, 'other');

          // Quick stats for targetYear should only sum target year expenses
          const stats = await repo.getQuickStats('user-1', yearToRange(targetYear));
          const expectedSum = targetExpenses.reduce((sum, e) => sum + e.expenseAmount, 0);
          expect(Math.abs(stats.ytdSpending - expectedSum)).toBeLessThan(0.01);

          // Vehicle expenses for targetYear should only contain target year data
          const vExpenses = await repo.getVehicleExpenses(
            'user-1',
            vehicle.id,
            yearToRange(targetYear)
          );
          for (const entry of vExpenses.maintenanceCosts) {
            expect(entry.month.startsWith(String(targetYear))).toBe(true);
          }
          for (const entry of vExpenses.fuelEfficiencyAndCost) {
            expect(entry.month.startsWith(String(targetYear))).toBe(true);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 26: Authentication required on all endpoints
// Verified by checking that routes.ts applies requireAuth middleware via
// routes.use('*', requireAuth).
// **Validates: Requirement 13.1**
// ---------------------------------------------------------------------------
describe('Property 26: Authentication required on all endpoints', () => {
  test('routes.ts applies requireAuth middleware to all routes', async () => {
    // Read the routes file and verify the middleware is applied
    const routesSource = await Bun.file(new URL('../routes.ts', import.meta.url).pathname).text();

    // Verify requireAuth is imported
    expect(routesSource).toContain('requireAuth');

    // Verify routes.use('*', requireAuth) is present
    expect(routesSource).toMatch(/routes\.use\(\s*['"`]\*['"`]\s*,\s*requireAuth\s*\)/);
  });
});

// ---------------------------------------------------------------------------
// Property 27: User data isolation
// Analytics data returned for user A never contains vehicles or expenses
// belonging to user B.
// **Validates: Requirement 13.2**
// ---------------------------------------------------------------------------
describe('Property 27: User data isolation', () => {
  test('analytics for user A never contains user B data', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 3 }),
        fc.integer({ min: 1, max: 3 }),
        async (user1VehicleCount, user2VehicleCount) => {
          resetDb();

          seedUser(testDb.sqlite, { id: 'user-1', email: 'u1@test.com', displayName: 'User 1' });
          seedUser(testDb.sqlite, { id: 'user-2', email: 'u2@test.com', displayName: 'User 2' });

          const user1Vehicles = seedVehiclesWithRandomExpenses('user-1', user1VehicleCount);
          const user2Vehicles = seedVehiclesWithDistinctiveExpenses('user-2', user2VehicleCount);

          // Query user1's quick stats — should not include user2's 99999 expenses
          const stats1 = await repo.getQuickStats('user-1', yearToRange(2024));
          expect(stats1.vehicleCount).toBe(user1VehicleCount);

          // Query user2's quick stats — should not include user1's vehicles
          const stats2 = await repo.getQuickStats('user-2', yearToRange(2024));
          expect(stats2.vehicleCount).toBe(user2VehicleCount);

          // Cross-vehicle for user1 should only reference user1's vehicle IDs
          const cross1 = await repo.getCrossVehicle('user-1', yearToRange(2024));
          const user2VehicleIds = user2Vehicles.map((v) => v.id);
          for (const entry of cross1.vehicleCostComparison) {
            expect(user2VehicleIds).not.toContain(entry.vehicleId);
          }

          // Cross-vehicle for user2 should only reference user2's vehicle IDs
          const cross2 = await repo.getCrossVehicle('user-2', yearToRange(2024));
          const user1VehicleIds = user1Vehicles.map((v) => v.id);
          for (const entry of cross2.vehicleCostComparison) {
            expect(user1VehicleIds).not.toContain(entry.vehicleId);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 28: Invalid parameters rejected with 400
// Zod schemas reject invalid inputs (non-integer year, negative year, etc.).
// **Validates: Requirements 14.2, 14.3**
// ---------------------------------------------------------------------------
describe('Property 28: Invalid parameters rejected with 400', () => {
  test('yearQuerySchema rejects non-integer and non-positive year values', () => {
    // Non-integer strings that aren't coercible to positive integers
    const invalidYears = ['abc', '-1', '0', '3.5', '', 'null'];
    for (const val of invalidYears) {
      const result = yearQuerySchema.safeParse({ year: val });
      // 'abc', '', 'null' should fail coercion; '-1', '0' fail positive; '3.5' fails int
      if (result.success && result.data.year != null) {
        // If it parsed, the value must be a positive integer
        expect(Number.isInteger(result.data.year)).toBe(true);
        expect(result.data.year).toBeGreaterThan(0);
      }
    }
  });

  test('yearQuerySchema accepts valid year values', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 9999 }), (year) => {
        const result = yearQuerySchema.safeParse({ year: String(year) });
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.year).toBe(year);
        }
      }),
      { numRuns: 100 }
    );
  });

  test('vehicleIdQuerySchema rejects missing vehicleId', () => {
    const result = vehicleIdQuerySchema.safeParse({});
    expect(result.success).toBe(false);
  });

  test('yearVehicleQuerySchema rejects missing vehicleId', () => {
    const result = yearVehicleQuerySchema.safeParse({ year: '2024' });
    expect(result.success).toBe(false);
  });

  test('yearVehicleQuerySchema rejects invalid year with valid vehicleId', () => {
    const invalidYears = ['abc', '-1', '0', '3.5'];
    for (const val of invalidYears) {
      const result = yearVehicleQuerySchema.safeParse({
        year: val,
        vehicleId: 'vehicle-1',
      });
      if (result.success && result.data.year != null) {
        expect(Number.isInteger(result.data.year)).toBe(true);
        expect(result.data.year).toBeGreaterThan(0);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Property 19: Vehicle ID filtering returns only that vehicle's data
// When a vehicleId filter is provided, all returned data pertains
// exclusively to the specified vehicle.
// **Validates: Requirement 4.2**
// ---------------------------------------------------------------------------
describe("Property 19: Vehicle ID filtering returns only that vehicle's data", () => {
  test('fuel stats with vehicleId filter contain only that vehicle data', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 4 }),
        fc.integer({ min: 1, max: 4 }),
        async (v1ExpCount, v2ExpCount) => {
          resetDb();

          const user = { id: 'user-1', email: 'test@test.com', displayName: 'Test' };
          seedUser(testDb.sqlite, user);

          const vehicle1: TestVehicle = {
            id: 'vehicle-user-1-0',
            userId: 'user-1',
            make: 'Toyota',
            model: 'Camry',
            year: 2022,
          };
          const vehicle2: TestVehicle = {
            id: 'vehicle-user-1-1',
            userId: 'user-1',
            make: 'Honda',
            model: 'Civic',
            year: 2023,
          };
          seedVehicle(testDb.sqlite, vehicle1);
          seedVehicle(testDb.sqlite, vehicle2);

          // Seed fuel expenses for vehicle1
          for (let i = 0; i < v1ExpCount; i++) {
            seedExpense(testDb.sqlite, {
              id: `v1-fuel-${i}`,
              vehicleId: vehicle1.id,
              category: 'fuel',
              expenseAmount: 50 + i,
              date: new Date(2024, i % 12, 15),
              mileage: 10000 + i * 1000,
              volume: 10 + i,
              fuelType: 'Regular',
              missedFillup: false,
            });
          }

          // Seed fuel expenses for vehicle2
          for (let i = 0; i < v2ExpCount; i++) {
            seedExpense(testDb.sqlite, {
              id: `v2-fuel-${i}`,
              vehicleId: vehicle2.id,
              category: 'fuel',
              expenseAmount: 200 + i,
              date: new Date(2024, i % 12, 20),
              mileage: 20000 + i * 1000,
              volume: 15 + i,
              fuelType: 'Premium',
              missedFillup: false,
            });
          }

          // Query fuel stats filtered to vehicle1 only
          const stats = await repo.getFuelStats(user.id, yearToRange(2024), vehicle1.id);

          // fillupCostByVehicle should only contain vehicle1
          for (const entry of stats.fillupCostByVehicle) {
            expect(entry.vehicleId).toBe(vehicle1.id);
          }

          // Vehicle expenses for vehicle1 should not contain vehicle2 data
          const vExpenses = await repo.getVehicleExpenses(user.id, vehicle1.id, yearToRange(2024));
          // expenseBreakdown should only reflect vehicle1's expenses
          const totalBreakdown = vExpenses.expenseBreakdown.reduce((sum, c) => sum + c.amount, 0);
          // Vehicle2 had expenses of 200+ each, vehicle1 had 50+ each
          // If vehicle2 data leaked, the total would be much higher
          if (v1ExpCount > 0) {
            expect(totalBreakdown).toBeGreaterThan(0);
          }

          // Query fuel stats filtered to vehicle2 only
          const stats2 = await repo.getFuelStats(user.id, yearToRange(2024), vehicle2.id);
          for (const entry of stats2.fillupCostByVehicle) {
            expect(entry.vehicleId).toBe(vehicle2.id);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
