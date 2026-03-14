/**
 * Property-Based Tests for Per-Vehicle Analytics (Health, TCO, Expenses)
 *
 * Property 10: Health score formula
 * overallScore = round(regularity * 0.4 + mileage * 0.35 + insurance * 0.25)
 * **Validates: Requirement 9.2**
 *
 * Property 11: Insurance coverage is binary
 * 100 with active policy, 0 without
 * **Validates: Requirement 9.4**
 *
 * Property 12: Maintenance regularity penalizes large gaps
 * Score decreases as proportion of >90-day gaps increases
 * **Validates: Requirement 9.5**
 *
 * Property 13: Mileage adherence scores good intervals
 * Score increases as proportion of 3000-7000 mile intervals increases
 * **Validates: Requirement 9.6**
 *
 * Property 14: TCO total equals sum of components
 * totalCost = purchasePrice + financingInterest + insuranceCost + fuelCost + maintenanceCost + otherCosts
 * **Validates: Requirement 10.2**
 *
 * Property 15: Cost per month formula
 * costPerMonth = totalCost / ownershipMonths when ownershipMonths > 0
 * **Validates: Requirement 10.4**
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import { AnalyticsRepository } from '../repository';
import {
  createTestDb,
  expenseArb,
  seedExpense,
  seedInsurancePolicy,
  seedUser,
  seedVehicle,
  type TestDb,
  type TestExpense,
  type TestInsurancePolicy,
  type TestVehicle,
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
// Helpers
// ---------------------------------------------------------------------------
const TEST_YEAR = 2024;

/** Reset DB and repo for a fresh property test iteration. */
function resetDb(): void {
  testDb.sqlite.close();
  testDb = createTestDb();
  repo = new AnalyticsRepository(testDb.drizzle);
}

/** Create user and a single vehicle, returning IDs. */
function setupUserAndVehicle(opts?: {
  insurancePolicyId?: string | null;
  purchasePrice?: number | null;
  purchaseDate?: Date | null;
}): { userId: string; vehicle: TestVehicle } {
  const user = { id: 'user-1', email: 'test@test.com', displayName: 'Test' };
  // Use INSERT OR IGNORE so this is safe to call even if user was pre-seeded (e.g., for insurance FK)
  testDb.sqlite.run('INSERT OR IGNORE INTO users (id, email, display_name) VALUES (?, ?, ?)', [
    user.id,
    user.email,
    user.displayName,
  ]);

  const v: TestVehicle = {
    id: 'vehicle-user-1-0',
    userId: 'user-1',
    make: 'Toyota',
    model: 'Camry',
    year: 2022,
    currentInsurancePolicyId: opts?.insurancePolicyId ?? null,
  };
  seedVehicle(testDb.sqlite, v);

  // Set purchase price/date if provided
  if (opts?.purchasePrice != null || opts?.purchaseDate != null) {
    const priceVal = opts?.purchasePrice ?? null;
    const dateVal = opts?.purchaseDate ? Math.floor(opts.purchaseDate.getTime() / 1000) : null;
    testDb.sqlite.run('UPDATE vehicles SET purchase_price = ?, purchase_date = ? WHERE id = ?', [
      priceVal,
      dateVal,
      v.id,
    ]);
  }

  return { userId: user.id, vehicle: v };
}

/** Seed maintenance expenses with specific dates for regularity testing. */
function seedMaintenanceWithDates(vehicleId: string, dates: Date[]): void {
  for (let i = 0; i < dates.length; i++) {
    const d = dates[i];
    if (!d) continue;
    seedExpense(testDb.sqlite, {
      id: `maint-${i}`,
      vehicleId,
      category: 'maintenance',
      expenseAmount: 100,
      date: d,
      mileage: null,
      fuelAmount: null,
      fuelType: null,
      missedFillup: false,
    });
  }
}

/** Seed maintenance expenses with specific mileages for mileage adherence testing. */
function seedMaintenanceWithMileages(vehicleId: string, mileages: number[]): void {
  const baseDate = new Date(TEST_YEAR, 0, 1);
  for (let i = 0; i < mileages.length; i++) {
    const m = mileages[i];
    if (m == null) continue;
    seedExpense(testDb.sqlite, {
      id: `maint-mile-${i}`,
      vehicleId,
      category: 'maintenance',
      expenseAmount: 100,
      date: new Date(baseDate.getTime() + i * 30 * 24 * 60 * 60 * 1000),
      mileage: m,
      fuelAmount: null,
      fuelType: null,
      missedFillup: false,
    });
  }
}

/** Seed random expenses for a vehicle. */
function seedRandomExpenses(vehicleId: string, count: number): void {
  const generated = fc.sample(expenseArb(vehicleId, 0, TEST_YEAR), count);
  for (let i = 0; i < generated.length; i++) {
    const e = generated[i];
    if (!e) continue;
    seedExpense(testDb.sqlite, { ...e, id: `expense-${i}` } as TestExpense);
  }
}

// ---------------------------------------------------------------------------
// Property 10: Health score formula
// **Validates: Requirement 9.2**
// ---------------------------------------------------------------------------
describe('Property 10: Health score formula', () => {
  test('overallScore = round(regularity * 0.4 + mileage * 0.35 + insurance * 0.25)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 0, max: 6 }),
        fc.boolean(),
        async (expenseCount, hasInsurance) => {
          resetDb();

          let policyId: string | null = null;
          if (hasInsurance) {
            policyId = 'policy-1';
            // Seed user first so the FK on insurance_policies.user_id is satisfied
            seedUser(testDb.sqlite, { id: 'user-1', email: 'test@test.com', displayName: 'Test' });
            const policy: TestInsurancePolicy = {
              id: policyId,
              userId: 'user-1',
              company: 'Test Insurance',
              isActive: true,
            };
            seedInsurancePolicy(testDb.sqlite, policy);
          }

          const { userId, vehicle } = setupUserAndVehicle({
            insurancePolicyId: policyId,
          });
          seedRandomExpenses(vehicle.id, expenseCount);

          const result = await repo.getVehicleHealth(userId, vehicle.id);

          // Verify the weighted formula
          const expected = Math.round(
            result.maintenanceRegularity * 0.4 +
              result.mileageIntervalAdherence * 0.35 +
              result.insuranceCoverage * 0.25
          );
          const clamped = Math.max(0, Math.min(100, expected));
          expect(result.overallScore).toBe(clamped);

          // All sub-scores bounded [0, 100]
          expect(result.maintenanceRegularity).toBeGreaterThanOrEqual(0);
          expect(result.maintenanceRegularity).toBeLessThanOrEqual(100);
          expect(result.mileageIntervalAdherence).toBeGreaterThanOrEqual(0);
          expect(result.mileageIntervalAdherence).toBeLessThanOrEqual(100);
          expect(result.insuranceCoverage).toBeGreaterThanOrEqual(0);
          expect(result.insuranceCoverage).toBeLessThanOrEqual(100);
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 11: Insurance coverage is binary
// **Validates: Requirement 9.4**
// ---------------------------------------------------------------------------
describe('Property 11: Insurance coverage is binary', () => {
  test('100 with active policy, 0 without', async () => {
    await fc.assert(
      fc.asyncProperty(fc.boolean(), fc.boolean(), async (hasPolicy, isActive) => {
        resetDb();

        let policyId: string | null = null;
        if (hasPolicy) {
          policyId = 'policy-1';
          // Seed user first so the FK on insurance_policies.user_id is satisfied
          seedUser(testDb.sqlite, { id: 'user-1', email: 'test@test.com', displayName: 'Test' });
          seedInsurancePolicy(testDb.sqlite, {
            id: policyId,
            userId: 'user-1',
            company: 'Test Co',
            isActive,
          });
        }

        const { userId, vehicle } = setupUserAndVehicle({
          insurancePolicyId: policyId,
        });

        const result = await repo.getVehicleHealth(userId, vehicle.id);

        if (hasPolicy && isActive) {
          expect(result.insuranceCoverage).toBe(100);
        } else {
          expect(result.insuranceCoverage).toBe(0);
        }
      }),
      { numRuns: 100 }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 12: Maintenance regularity penalizes large gaps
// **Validates: Requirement 9.5**
// ---------------------------------------------------------------------------
describe('Property 12: Maintenance regularity penalizes large gaps', () => {
  test('score decreases as proportion of >90-day gaps increases', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 0, max: 5 }),
        fc.integer({ min: 0, max: 5 }),
        async (goodGapCount, badGapCount) => {
          resetDb();
          const { userId, vehicle } = setupUserAndVehicle();

          const totalRecords = goodGapCount + badGapCount + 1;
          const dates: Date[] = [];
          let current = new Date(TEST_YEAR, 0, 1);
          dates.push(current);

          // Add good gaps (30 days apart, well under 90)
          for (let i = 0; i < goodGapCount; i++) {
            current = new Date(current.getTime() + 30 * 24 * 60 * 60 * 1000);
            dates.push(current);
          }
          // Add bad gaps (120 days apart, over 90)
          for (let i = 0; i < badGapCount; i++) {
            current = new Date(current.getTime() + 120 * 24 * 60 * 60 * 1000);
            dates.push(current);
          }

          seedMaintenanceWithDates(vehicle.id, dates);

          const result = await repo.getVehicleHealth(userId, vehicle.id);

          if (totalRecords < 2) {
            // With 0 records: 50, with 1 record: 75
            expect(result.maintenanceRegularity).toBeGreaterThanOrEqual(50);
          } else {
            const totalGaps = goodGapCount + badGapCount;
            if (totalGaps > 0) {
              const badProportion = badGapCount / totalGaps;
              const expectedScore = Math.max(0, Math.round(100 - badProportion * 100));
              expect(result.maintenanceRegularity).toBe(expectedScore);
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 13: Mileage adherence scores good intervals
// **Validates: Requirement 9.6**
// ---------------------------------------------------------------------------
describe('Property 13: Mileage adherence scores good intervals', () => {
  test('score increases as proportion of 3000-7000 mile intervals increases', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 0, max: 5 }),
        fc.integer({ min: 0, max: 5 }),
        async (goodIntervalCount, badIntervalCount) => {
          resetDb();
          const { userId, vehicle } = setupUserAndVehicle();

          const totalRecords = goodIntervalCount + badIntervalCount + 1;
          const mileages: number[] = [];
          let currentMileage = 10000;
          mileages.push(currentMileage);

          // Add good intervals (5000 miles, within 3000-7000)
          for (let i = 0; i < goodIntervalCount; i++) {
            currentMileage += 5000;
            mileages.push(currentMileage);
          }
          // Add bad intervals (15000 miles, outside 3000-7000)
          for (let i = 0; i < badIntervalCount; i++) {
            currentMileage += 15000;
            mileages.push(currentMileage);
          }

          seedMaintenanceWithMileages(vehicle.id, mileages);

          const result = await repo.getVehicleHealth(userId, vehicle.id);

          if (totalRecords < 2) {
            expect(result.mileageIntervalAdherence).toBe(50);
          } else {
            const totalIntervals = goodIntervalCount + badIntervalCount;
            if (totalIntervals > 0) {
              const expectedScore = Math.round((goodIntervalCount / totalIntervals) * 100);
              expect(result.mileageIntervalAdherence).toBe(expectedScore);
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 14: TCO total equals sum of components
// **Validates: Requirement 10.2**
// ---------------------------------------------------------------------------
describe('Property 14: TCO total equals sum of components', () => {
  test('totalCost = purchasePrice + financingInterest + insuranceCost + fuelCost + maintenanceCost + otherCosts', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 0, max: 8 }),
        fc.option(fc.double({ min: 1000, max: 100000, noNaN: true, noDefaultInfinity: true }), {
          nil: null,
        }),
        async (expenseCount, purchasePrice) => {
          resetDb();
          const { userId, vehicle } = setupUserAndVehicle({
            purchasePrice,
            purchaseDate: new Date(2020, 0, 1),
          });
          seedRandomExpenses(vehicle.id, expenseCount);

          const result = await repo.getVehicleTCO(userId, vehicle.id);

          const componentSum =
            (result.purchasePrice ?? 0) +
            result.financingInterest +
            result.insuranceCost +
            result.fuelCost +
            result.maintenanceCost +
            result.otherCosts;

          expect(Math.abs(result.totalCost - componentSum)).toBeLessThan(0.01);
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 15: Cost per month formula
// **Validates: Requirement 10.4**
// ---------------------------------------------------------------------------
describe('Property 15: Cost per month formula', () => {
  test('costPerMonth = totalCost / ownershipMonths when ownershipMonths > 0', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 0, max: 5 }),
        fc.integer({ min: 1, max: 48 }),
        async (expenseCount, monthsAgo) => {
          resetDb();
          const now = new Date();
          const purchaseDate = new Date(now.getFullYear(), now.getMonth() - monthsAgo, 1);

          const { userId, vehicle } = setupUserAndVehicle({
            purchasePrice: 25000,
            purchaseDate,
          });
          seedRandomExpenses(vehicle.id, expenseCount);

          const result = await repo.getVehicleTCO(userId, vehicle.id);

          if (result.ownershipMonths > 0) {
            const expectedCostPerMonth = result.totalCost / result.ownershipMonths;
            expect(Math.abs(result.costPerMonth - expectedCostPerMonth)).toBeLessThan(0.01);
          } else {
            expect(result.costPerMonth).toBe(0);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
