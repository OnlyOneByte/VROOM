import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import { AnalyticsRepository } from '../repository';
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

let testDb: TestDb;
let repo: AnalyticsRepository;

beforeEach(() => {
  testDb = createTestDb();
  repo = new AnalyticsRepository(testDb.drizzle);
});

afterEach(() => {
  testDb.sqlite.close();
});

function resetDb(): void {
  testDb.sqlite.close();
  testDb = createTestDb();
  repo = new AnalyticsRepository(testDb.drizzle);
}

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

describe('Vehicle ownership validation', () => {
  test('per-vehicle endpoints return empty/zero data for non-owned vehicleId', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 4 }), async (expenseCount) => {
        resetDb();

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

        const expenses = fc.sample(expenseArb(vehicle2.id, 0, 2024), expenseCount);
        for (let i = 0; i < expenses.length; i++) {
          const e = expenses[i];
          if (!e) continue;
          seedExpense(testDb.sqlite, { ...e, id: `exp-${i}` });
        }

        const health = await repo.getVehicleHealth(user1.id, vehicle2.id);
        expect(health.insuranceCoverage).toBe(0);
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

describe('Year scoping filters correctly', () => {
  test('querying year X returns no data from year Y', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 2021, max: 2024 }),
        fc.integer({ min: 1, max: 5 }),
        fc.integer({ min: 1, max: 5 }),
        async (targetYear, targetCount, otherCount) => {
          resetDb();

          const vehicle = seedUserAndVehicle('user-1', 'test@test.com', 'Test');

          const targetExpenses = seedSampledExpenses(vehicle.id, targetCount, targetYear, 'target');

          const otherYear = targetYear === 2024 ? 2022 : targetYear + 1;
          seedSampledExpenses(vehicle.id, otherCount, otherYear, 'other');

          const stats = await repo.getQuickStats('user-1', yearToRange(targetYear));
          const expectedSum = targetExpenses.reduce((sum, e) => sum + e.expenseAmount, 0);
          expect(Math.abs(stats.ytdSpending - expectedSum)).toBeLessThan(0.01);

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

describe('Authentication required on all endpoints', () => {
  test('routes.ts applies requireAuth middleware to all routes', async () => {
    const routesSource = await Bun.file(new URL('../routes.ts', import.meta.url).pathname).text();

    expect(routesSource).toContain('requireAuth');

    expect(routesSource).toMatch(/routes\.use\(\s*['"`]\*['"`]\s*,\s*requireAuth\s*\)/);
  });
});

describe('User data isolation', () => {
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

          const stats1 = await repo.getQuickStats('user-1', yearToRange(2024));
          expect(stats1.vehicleCount).toBe(user1VehicleCount);

          const stats2 = await repo.getQuickStats('user-2', yearToRange(2024));
          expect(stats2.vehicleCount).toBe(user2VehicleCount);

          const cross1 = await repo.getCrossVehicle('user-1', yearToRange(2024));
          const user2VehicleIds = user2Vehicles.map((v) => v.id);
          for (const entry of cross1.vehicleCostComparison) {
            expect(user2VehicleIds).not.toContain(entry.vehicleId);
          }

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

describe("Vehicle ID filtering returns only that vehicle's data", () => {
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

          const stats = await repo.getFuelStats(user.id, yearToRange(2024), vehicle1.id);

          for (const entry of stats.fillupCostByVehicle) {
            expect(entry.vehicleId).toBe(vehicle1.id);
          }

          const vExpenses = await repo.getVehicleExpenses(user.id, vehicle1.id, yearToRange(2024));
          const totalBreakdown = vExpenses.expenseBreakdown.reduce((sum, c) => sum + c.amount, 0);
          if (v1ExpCount > 0) {
            expect(totalBreakdown).toBeGreaterThan(0);
          }

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
