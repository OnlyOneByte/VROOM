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

let testDb: TestDb;
let repo: AnalyticsRepository;

beforeEach(() => {
  testDb = createTestDb();
  repo = new AnalyticsRepository(testDb.drizzle);
});

afterEach(() => {
  testDb.sqlite.close();
});

const TEST_YEAR = 2024;

function resetDb(): void {
  testDb.sqlite.close();
  testDb = createTestDb();
  repo = new AnalyticsRepository(testDb.drizzle);
}

function setupUserAndVehicle(opts?: {
  purchasePrice?: number | null;
  purchaseDate?: Date | null;
}): { userId: string; vehicle: TestVehicle } {
  const user = { id: 'user-1', email: 'test@test.com', displayName: 'Test' };
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
  };
  seedVehicle(testDb.sqlite, v);

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
      volume: null,
      fuelType: null,
      missedFillup: false,
    });
  }
}

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
      volume: null,
      fuelType: null,
      missedFillup: false,
    });
  }
}

function seedRandomExpenses(vehicleId: string, count: number): void {
  const generated = fc.sample(expenseArb(vehicleId, 0, TEST_YEAR), count);
  for (let i = 0; i < generated.length; i++) {
    const e = generated[i];
    if (!e) continue;
    seedExpense(testDb.sqlite, { ...e, id: `expense-${i}` } as TestExpense);
  }
}

describe('Health score formula', () => {
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
            seedUser(testDb.sqlite, { id: 'user-1', email: 'test@test.com', displayName: 'Test' });
            const policy: TestInsurancePolicy = {
              id: policyId,
              userId: 'user-1',
              company: 'Test Insurance',
              isActive: true,
            };
            seedInsurancePolicy(testDb.sqlite, policy);
          }

          const { userId, vehicle } = setupUserAndVehicle({});
          seedRandomExpenses(vehicle.id, expenseCount);

          const result = await repo.getVehicleHealth(userId, vehicle.id);

          const expected = Math.round(
            result.maintenanceRegularity * 0.4 +
              result.mileageIntervalAdherence * 0.35 +
              result.insuranceCoverage * 0.25
          );
          const clamped = Math.max(0, Math.min(100, expected));
          expect(result.overallScore).toBe(clamped);

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

describe('Insurance coverage is binary', () => {
  test('100 with active policy, 0 without', async () => {
    await fc.assert(
      fc.asyncProperty(fc.boolean(), fc.boolean(), async (hasPolicy, isActive) => {
        resetDb();

        const { userId, vehicle } = setupUserAndVehicle({});

        if (hasPolicy) {
          const policyId = 'policy-1';
          const termId = 'term-1';
          seedInsurancePolicy(testDb.sqlite, {
            id: policyId,
            userId,
            company: 'Test Co',
            isActive,
          });
          testDb.sqlite.run(
            'INSERT INTO insurance_terms (id, policy_id, start_date, end_date) VALUES (?, ?, ?, ?)',
            [
              termId,
              policyId,
              Math.floor(Date.now() / 1000) - 86400,
              Math.floor(Date.now() / 1000) + 86400 * 365,
            ]
          );
          testDb.sqlite.run(
            'INSERT INTO insurance_term_vehicles (term_id, vehicle_id) VALUES (?, ?)',
            [termId, vehicle.id]
          );
        }

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

describe('Maintenance regularity penalizes large gaps', () => {
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

          for (let i = 0; i < goodGapCount; i++) {
            current = new Date(current.getTime() + 30 * 24 * 60 * 60 * 1000);
            dates.push(current);
          }
          for (let i = 0; i < badGapCount; i++) {
            current = new Date(current.getTime() + 120 * 24 * 60 * 60 * 1000);
            dates.push(current);
          }

          seedMaintenanceWithDates(vehicle.id, dates);

          const result = await repo.getVehicleHealth(userId, vehicle.id);

          if (totalRecords < 2) {
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

describe('Mileage adherence scores good intervals', () => {
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

          for (let i = 0; i < goodIntervalCount; i++) {
            currentMileage += 5000;
            mileages.push(currentMileage);
          }
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

describe('TCO total equals sum of components', () => {
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

describe('financed vehicle TCO does not double-count principal', () => {
  function seedFinancingPayment(vehicleId: string, id: string, amount: number, date: Date): void {
    testDb.sqlite.run(
      'INSERT INTO expenses (id, vehicle_id, user_id, category, expense_amount, date, source_type, missed_fillup) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [
        id,
        vehicleId,
        'user-1',
        'financial',
        amount,
        Math.floor(date.getTime() / 1000),
        'financing',
        0,
      ]
    );
  }

  test('purchasePrice counted → financing-payment rows are EXCLUDED from the total (no double-count)', async () => {
    const { userId, vehicle } = setupUserAndVehicle({
      purchasePrice: 30000,
      purchaseDate: new Date(2020, 0, 1),
    });
    seedFinancingPayment(vehicle.id, 'fin-1', 500, new Date(2024, 0, 15));
    seedFinancingPayment(vehicle.id, 'fin-2', 500, new Date(2024, 1, 15));
    seedFinancingPayment(vehicle.id, 'fin-3', 500, new Date(2024, 2, 15));
    seedExpense(testDb.sqlite, {
      id: 'fuel-1',
      vehicleId: vehicle.id,
      category: 'fuel',
      expenseAmount: 60,
      date: new Date(2024, 0, 20),
      mileage: null,
      volume: 10,
      fuelType: 'gasoline',
      missedFillup: false,
    } as TestExpense);

    const result = await repo.getVehicleTCO(userId, vehicle.id);

    expect(result.totalCost).toBe(30060);
    expect(result.financingInterest).toBe(0);
    const componentSum =
      (result.purchasePrice ?? 0) +
      result.financingInterest +
      result.insuranceCost +
      result.fuelCost +
      result.maintenanceCost +
      result.otherCosts;
    expect(Math.abs(result.totalCost - componentSum)).toBeLessThan(0.01);
  });

  test('NO purchasePrice → financing payments ARE counted (they are the only acquisition signal)', async () => {
    const { userId, vehicle } = setupUserAndVehicle({
      purchasePrice: null,
      purchaseDate: new Date(2020, 0, 1),
    });
    seedFinancingPayment(vehicle.id, 'fin-1', 500, new Date(2024, 0, 15));
    seedFinancingPayment(vehicle.id, 'fin-2', 500, new Date(2024, 1, 15));

    const result = await repo.getVehicleTCO(userId, vehicle.id);

    expect(result.totalCost).toBe(1000);
    expect(result.financingInterest).toBe(1000);
  });
});

describe('TCO buckets financial rows by sourceType (recurring/manual → otherCosts, not financing)', () => {
  function seedFinancialRow(
    vehicleId: string,
    id: string,
    amount: number,
    sourceType: string | null
  ): void {
    testDb.sqlite.run(
      'INSERT INTO expenses (id, vehicle_id, user_id, category, expense_amount, date, source_type, missed_fillup) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [
        id,
        vehicleId,
        'user-1',
        'financial',
        amount,
        Math.floor(new Date(2024, 0, 15).getTime() / 1000),
        sourceType,
        0,
      ]
    );
  }

  test('a recurring (reminder) + a manual (null) financial row land in otherCosts, not financingInterest', async () => {
    const { userId, vehicle } = setupUserAndVehicle({ purchasePrice: null });
    seedFinancialRow(vehicle.id, 'fin', 200, 'financing');
    seedFinancialRow(vehicle.id, 'ins', 75, 'insurance_term');
    seedFinancialRow(vehicle.id, 'rem', 100, 'reminder');
    seedFinancialRow(vehicle.id, 'man', 50, null);

    const result = await repo.getVehicleTCO(userId, vehicle.id);

    expect(result.financingInterest).toBe(200);
    expect(result.insuranceCost).toBe(75);
    expect(result.otherCosts).toBe(150);
    expect(result.totalCost).toBe(425);
  });

  test('PRICED + a recurring financial row → the recurring cost survives in otherCosts', async () => {
    const { userId, vehicle } = setupUserAndVehicle({ purchasePrice: 30000 });
    seedFinancialRow(vehicle.id, 'rem', 100, 'reminder');

    const result = await repo.getVehicleTCO(userId, vehicle.id);

    expect(result.financingInterest).toBe(0);
    expect(result.otherCosts).toBe(100);
    expect(result.totalCost).toBe(30100);
  });
});

describe('year-scoped: purchasePrice excluded from a year window; that year financing kept', () => {
  function seedFinancingPayment(vehicleId: string, id: string, amount: number, date: Date): void {
    testDb.sqlite.run(
      'INSERT INTO expenses (id, vehicle_id, user_id, category, expense_amount, date, source_type, missed_fillup) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [
        id,
        vehicleId,
        'user-1',
        'financial',
        amount,
        Math.floor(date.getTime() / 1000),
        'financing',
        0,
      ]
    );
  }

  test('PRICED + financed, year-scoped: purchasePrice is EXCLUDED, the year financing IS counted', async () => {
    const { userId, vehicle } = setupUserAndVehicle({
      purchasePrice: 30000,
      purchaseDate: new Date(2020, 0, 1),
    });
    seedFinancingPayment(vehicle.id, 'fin-in-1', 500, new Date(TEST_YEAR, 0, 15));
    seedFinancingPayment(vehicle.id, 'fin-in-2', 500, new Date(TEST_YEAR, 5, 15));
    seedFinancingPayment(vehicle.id, 'fin-out', 999, new Date(TEST_YEAR - 1, 11, 15));

    const result = await repo.getVehicleTCO(userId, vehicle.id, TEST_YEAR);

    expect(result.totalCost).toBe(1000);
    expect(result.financingInterest).toBe(1000);
    expect(result.purchasePrice).toBe(30000);
    expect(result.totalCost).toBe(
      result.financingInterest +
        result.insuranceCost +
        result.fuelCost +
        result.maintenanceCost +
        result.otherCosts
    );
  });

  test('UNPRICED + financed, year-scoped: the year financing IS counted', async () => {
    const { userId, vehicle } = setupUserAndVehicle({
      purchasePrice: null,
      purchaseDate: new Date(2020, 0, 1),
    });
    seedFinancingPayment(vehicle.id, 'fin-1', 500, new Date(TEST_YEAR, 2, 1));
    seedFinancingPayment(vehicle.id, 'fin-2', 500, new Date(TEST_YEAR, 8, 1));

    const result = await repo.getVehicleTCO(userId, vehicle.id, TEST_YEAR);

    expect(result.totalCost).toBe(1000);
    expect(result.financingInterest).toBe(1000);
  });

  test('year-scoped costPerMonth divides by months owned in that year, not full ownership', async () => {
    const { userId, vehicle } = setupUserAndVehicle({
      purchasePrice: 30000,
      purchaseDate: new Date(2020, 0, 1),
    });
    seedFinancingPayment(vehicle.id, 'fin-cpm', 1200, new Date(TEST_YEAR, 5, 15));

    const result = await repo.getVehicleTCO(userId, vehicle.id, TEST_YEAR);

    expect(result.totalCost).toBe(1200);
    expect(result.ownershipMonths).toBe(12);
    expect(result.costPerMonth).toBe(100);
  });

  test('year-scoped total = the windowed buckets (financing + fuel), purchasePrice NOT added', async () => {
    const { userId, vehicle } = setupUserAndVehicle({
      purchasePrice: 30000,
      purchaseDate: new Date(2020, 0, 1),
    });
    seedFinancingPayment(vehicle.id, 'fin-1', 500, new Date(TEST_YEAR, 0, 15));
    seedExpense(testDb.sqlite, {
      id: 'fuel-yr',
      vehicleId: vehicle.id,
      category: 'fuel',
      expenseAmount: 60,
      date: new Date(TEST_YEAR, 0, 20),
      mileage: null,
      volume: 10,
      fuelType: 'gasoline',
      missedFillup: false,
    } as TestExpense);

    const result = await repo.getVehicleTCO(userId, vehicle.id, TEST_YEAR);

    const windowedBuckets =
      result.financingInterest +
      result.insuranceCost +
      result.fuelCost +
      result.maintenanceCost +
      result.otherCosts;
    expect(Math.abs(result.totalCost - windowedBuckets)).toBeLessThan(0.01);
    expect(result.totalCost).toBe(560);
  });
});

describe('Cost per month formula', () => {
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

const VEHICLE_HEALTH_KEYS = [
  'vehicleId',
  'vehicleName',
  'overallScore',
  'maintenanceRegularity',
  'mileageIntervalAdherence',
  'insuranceCoverage',
].sort();

describe('getVehicleHealth — response shape matches the frontend contract', () => {
  test('the response has exactly the frontend VehicleHealthResponse top-level keys', async () => {
    const { userId, vehicle } = setupUserAndVehicle({});
    const result = await repo.getVehicleHealth(userId, vehicle.id);
    expect(Object.keys(result).sort()).toEqual(VEHICLE_HEALTH_KEYS);
  });

  test('every score field is a finite number (no NaN escape on a no-data vehicle)', async () => {
    const { userId, vehicle } = setupUserAndVehicle({});
    const result = await repo.getVehicleHealth(userId, vehicle.id);
    for (const k of [
      'overallScore',
      'maintenanceRegularity',
      'mileageIntervalAdherence',
      'insuranceCoverage',
    ] as const) {
      expect(Number.isFinite(result[k]), k).toBe(true);
    }
  });
});
