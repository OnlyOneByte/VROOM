import { describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import { AnalyticsRepository } from '../repository';
import {
  createTestDb,
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

describe('Summary data equivalence', () => {
  test('getSummary() produces identical results to calling getQuickStats(), getFuelStats(), getFuelAdvanced() independently', async () => {
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
          const testDb: TestDb = createTestDb();
          try {
            const repo = new AnalyticsRepository(testDb.drizzle);

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
                  expenseListArb(v.id, {
                    minLength: 0,
                    maxLength: 8,
                    yearConstraint: targetYear,
                  }),
                  1
                )[0] ?? [];
              allExpenses.push(...yearExpenses);
            }

            for (const e of allExpenses) {
              seedExpense(testDb.sqlite, e);
            }

            const range = yearToRange(targetYear);

            const [summary, quickStats, fuelStats, fuelAdvanced] = await Promise.all([
              repo.getSummary(user.id, range),
              repo.getQuickStats(user.id, range),
              repo.getFuelStats(user.id, range),
              repo.getFuelAdvanced(user.id, range),
            ]);

            expect(summary.quickStats.vehicleCount).toBe(quickStats.vehicleCount);
            expect(summary.quickStats.fleetHealthScore).toBe(quickStats.fleetHealthScore);
            expect(Math.abs(summary.quickStats.ytdSpending - quickStats.ytdSpending)).toBeLessThan(
              0.01
            );
            if (quickStats.avgEfficiency === null) {
              expect(summary.quickStats.avgEfficiency).toBeNull();
            } else {
              expect(summary.quickStats.avgEfficiency).not.toBeNull();
              expect(
                Math.abs((summary.quickStats.avgEfficiency as number) - quickStats.avgEfficiency)
              ).toBeLessThan(0.001);
            }

            expect(summary.fuelStats).toEqual(fuelStats);

            expect(summary.fuelAdvanced).toEqual(fuelAdvanced);
          } finally {
            testDb.sqlite.close();
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
