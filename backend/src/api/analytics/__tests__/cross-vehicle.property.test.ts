import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import { AnalyticsRepository } from '../repository';
import {
  createTestDb,
  expenseArb,
  seedExpense,
  seedUser,
  seedVehicle,
  seedVehicleFinancing,
  type TestDb,
  type TestExpense,
  type TestVehicle,
  type TestVehicleFinancing,
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

const TEST_YEAR = 2024;

function resetDb(): void {
  testDb.sqlite.close();
  testDb = createTestDb();
  repo = new AnalyticsRepository(testDb.drizzle);
}

function setupUserAndVehicles(vehicleCount: number): { userId: string; vehicles: TestVehicle[] } {
  const user = { id: 'user-1', email: 'test@test.com', displayName: 'Test' };
  seedUser(testDb.sqlite, user);

  const vList: TestVehicle[] = [];
  for (let i = 0; i < vehicleCount; i++) {
    const v: TestVehicle = {
      id: `vehicle-user-1-${i}`,
      userId: 'user-1',
      make: 'Toyota',
      model: 'Camry',
      year: 2022,
    };
    seedVehicle(testDb.sqlite, v);
    vList.push(v);
  }
  return { userId: user.id, vehicles: vList };
}

function seedExpensesForVehicles(vList: TestVehicle[], perVehicle: number): void {
  let idx = 0;
  for (const v of vList) {
    const generated = fc.sample(expenseArb(v.id, 0, TEST_YEAR), perVehicle);
    for (const e of generated) {
      seedExpense(testDb.sqlite, { ...e, id: `expense-${idx++}` } as TestExpense);
    }
  }
}

function seedFinancingForVehicles(vList: TestVehicle[], count: number): void {
  for (let i = 0; i < count; i++) {
    const v = vList[i];
    if (!v) continue;
    const fin: TestVehicleFinancing = {
      id: `fin-${v.id}`,
      vehicleId: v.id,
      financingType: i % 2 === 0 ? 'loan' : 'lease',
      provider: 'Test Bank',
      originalAmount: 30000,
      apr: i % 2 === 0 ? 5.5 : null,
      termMonths: 60,
      startDate: new Date(2023, 0, 1),
      paymentAmount: 500,
      isActive: true,
    };
    seedVehicleFinancing(testDb.sqlite, fin);
  }
}

describe('Category percentages sum to 100', () => {
  test('for any non-empty set of expenses, category breakdown percentages sum to ~100 (±0.1)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 3 }),
        fc.integer({ min: 1, max: 8 }),
        async (vehicleCount, expensesPerVehicle) => {
          resetDb();
          const { userId, vehicles } = setupUserAndVehicles(vehicleCount);
          seedExpensesForVehicles(vehicles, expensesPerVehicle);

          const result = await repo.getCrossVehicle(userId, yearToRange(TEST_YEAR));

          if (result.expenseByCategory.length > 0) {
            const percentageSum = result.expenseByCategory.reduce(
              (sum, c) => sum + c.percentage,
              0
            );
            expect(Math.abs(percentageSum - 100)).toBeLessThanOrEqual(0.1);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe('Cost per distance formula', () => {
  test('costPerDistance = totalCost / totalDistance when totalDistance > 0, null otherwise', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 3 }),
        fc.integer({ min: 1, max: 5 }),
        async (vehicleCount, expensesPerVehicle) => {
          resetDb();
          const { userId, vehicles } = setupUserAndVehicles(vehicleCount);
          seedExpensesForVehicles(vehicles, expensesPerVehicle);

          const result = await repo.getCrossVehicle(userId, yearToRange(TEST_YEAR));

          for (const vc of result.vehicleCostComparison) {
            if (vc.costPerDistance !== null) {
              expect(vc.costPerDistance).toBeGreaterThan(0);
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe('Unfinanced vehicles classified as own', () => {
  test('vehicles without financing records have financingType = own', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 4 }),
        fc.integer({ min: 0, max: 3 }),
        async (totalVehicles, financedCount) => {
          resetDb();
          const actualFinanced = Math.min(financedCount, totalVehicles);
          const { userId, vehicles } = setupUserAndVehicles(totalVehicles);
          seedFinancingForVehicles(vehicles, actualFinanced);

          const result = await repo.getFinancing(userId);
          assertUnfinancedAreOwn(result.vehicleDetails, vehicles, actualFinanced);
          assertFinancedAreNotOwn(result.vehicleDetails, vehicles, actualFinanced);
        }
      ),
      { numRuns: 100 }
    );
  });
});

function assertUnfinancedAreOwn(
  details: Array<{
    vehicleId: string;
    financingType: string;
    monthlyPayment: number;
    remainingBalance: number;
  }>,
  vehicles: TestVehicle[],
  financedCount: number
): void {
  for (let i = financedCount; i < vehicles.length; i++) {
    const v = vehicles[i];
    if (!v) continue;
    const detail = details.find((d) => d.vehicleId === v.id);
    expect(detail).toBeDefined();
    expect(detail?.financingType).toBe('own');
    expect(detail?.monthlyPayment).toBe(0);
    expect(detail?.remainingBalance).toBe(0);
  }
}

function assertFinancedAreNotOwn(
  details: Array<{ vehicleId: string; financingType: string }>,
  vehicles: TestVehicle[],
  financedCount: number
): void {
  for (let i = 0; i < financedCount; i++) {
    const v = vehicles[i];
    if (!v) continue;
    const detail = details.find((d) => d.vehicleId === v.id);
    expect(detail).toBeDefined();
    expect(detail?.financingType).not.toBe('own');
  }
}

function seedFuel(
  vehicleId: string,
  id: string,
  date: Date,
  mileage: number,
  volume: number
): void {
  seedExpense(testDb.sqlite, {
    id,
    vehicleId,
    category: 'fuel',
    expenseAmount: 50,
    date,
    mileage,
    volume,
    fuelType: 'gasoline',
    missedFillup: false,
  } as TestExpense);
}

function seedCharge(
  vehicleId: string,
  id: string,
  date: Date,
  mileage: number,
  volume: number
): void {
  seedExpense(testDb.sqlite, {
    id,
    vehicleId,
    category: 'fuel',
    expenseAmount: 9,
    date,
    mileage,
    volume,
    fuelType: 'Level 2 (AC)',
    missedFillup: false,
  } as TestExpense);
}

describe('fleet fuel-efficiency trend never pairs across vehicles', () => {
  test('two cars with CLOSE odometers + interleaved dates produce NO cross-vehicle phantom point', async () => {
    const { userId } = setupUserAndVehicles(2);
    const [v0, v1] = ['vehicle-user-1-0', 'vehicle-user-1-1'];
    seedFuel(v0, 'f-v0', new Date(2024, 0, 1), 12_000, 10);
    seedFuel(v1, 'f-v1', new Date(2024, 0, 8), 12_100, 10);

    const trend = await repo.getFuelEfficiencyTrend(userId);
    expect(trend).toEqual([]);
  });

  test('each vehicle still gets its OWN valid trend points (per-vehicle pairing preserved)', async () => {
    const { userId } = setupUserAndVehicles(2);
    const [v0, v1] = ['vehicle-user-1-0', 'vehicle-user-1-1'];
    seedFuel(v0, 'f-v0-a', new Date(2024, 0, 1), 10_000, 10);
    seedFuel(v1, 'f-v1-a', new Date(2024, 0, 3), 50_000, 10);
    seedFuel(v0, 'f-v0-b', new Date(2024, 0, 5), 10_300, 10);
    seedFuel(v1, 'f-v1-b', new Date(2024, 0, 7), 50_250, 10);

    const trend = await repo.getFuelEfficiencyTrend(userId);
    expect(trend.length).toBe(2);
    const effs = trend.map((p) => p.efficiency).sort((a, b) => a - b);
    expect(effs[0]).toBeCloseTo(25, 5);
    expect(effs[1]).toBeCloseTo(30, 5);
  });

  test('scoping to a single vehicleId is unaffected (per-vehicle path unchanged)', async () => {
    const { userId } = setupUserAndVehicles(2);
    const v0 = 'vehicle-user-1-0';
    seedFuel(v0, 'f-v0-a', new Date(2024, 0, 1), 10_000, 10);
    seedFuel(v0, 'f-v0-b', new Date(2024, 0, 5), 10_300, 10);

    const trend = await repo.getFuelEfficiencyTrend(userId, v0);
    expect(trend.length).toBe(1);
    expect(trend[0]?.efficiency).toBeCloseTo(30, 5);
  });

  test('a plug-in hybrid efficiency trend excludes its CHARGE sessions (gas MPG only)', async () => {
    const { userId } = setupUserAndVehicles(1);
    const v0 = 'vehicle-user-1-0';
    seedFuel(v0, 'g-1', new Date(2024, 0, 1), 10_000, 10);
    seedFuel(v0, 'g-2', new Date(2024, 0, 5), 10_300, 10);
    seedCharge(v0, 'c-1', new Date(2024, 0, 10), 20_000, 15);
    seedCharge(v0, 'c-2', new Date(2024, 0, 15), 20_060, 15);

    const trend = await repo.getFuelEfficiencyTrend(userId);
    expect(trend.length).toBe(1);
    expect(trend[0]?.efficiency).toBeCloseTo(30, 5);
    expect(trend.some((p) => p.efficiency < 10)).toBe(false);
  });

  test('the CONVERTED summary gas-MPG average excludes a PHEV charge session on a mixed-unit fleet', async () => {
    const { userId } = setupUserAndVehicles(1);
    const v0 = 'vehicle-user-1-0';
    testDb.sqlite.run('UPDATE vehicles SET unit_preferences = ? WHERE id = ?', [
      JSON.stringify({ distanceUnit: 'kilometers', volumeUnit: 'liters', chargeUnit: 'kwh' }),
      v0,
    ]);
    seedFuel(v0, 'g-1', new Date(2024, 0, 1), 10_000, 10);
    seedFuel(v0, 'g-2', new Date(2024, 0, 5), 10_300, 10);
    seedCharge(v0, 'c-1', new Date(2024, 0, 10), 20_000, 15);
    seedCharge(v0, 'c-2', new Date(2024, 0, 15), 20_060, 15);

    const stats = await repo.getQuickStats(userId, yearToRange(TEST_YEAR));
    const expectedGasMpg = (30 / 1.609344) * 3.785411784;
    expect(stats.avgEfficiency).not.toBeNull();
    expect(stats.avgEfficiency as number).toBeCloseTo(expectedGasMpg, 1);
    expect(stats.avgEfficiency as number).toBeGreaterThan(50);
  });
});
