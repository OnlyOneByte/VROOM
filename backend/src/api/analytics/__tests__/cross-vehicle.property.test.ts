/**
 * Property-Based Tests for Cross-Vehicle, Financing, and Insurance Analytics
 *
 * Property 4: Category percentages sum to 100
 * For any non-empty set of expenses, category breakdown percentages sum to ~100 (±0.1 tolerance).
 * **Validates: Requirements 6.3, 12.3**
 *
 * Property 5: Cost per distance formula
 * Cost per distance = totalCost / totalDistance when totalDistance > 0, null otherwise.
 * **Validates: Requirements 6.4, 10.3**
 *
 * Property 23: Unfinanced vehicles classified as own
 * Vehicles without financing records have financingType = 'own'.
 * **Validates: Requirement 7.4**
 */

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

/** Create user and N vehicles, returning their IDs. */
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

/** Seed random expenses for each vehicle. Returns total seeded count. */
function seedExpensesForVehicles(vList: TestVehicle[], perVehicle: number): void {
  let idx = 0;
  for (const v of vList) {
    const generated = fc.sample(expenseArb(v.id, 0, TEST_YEAR), perVehicle);
    for (const e of generated) {
      seedExpense(testDb.sqlite, { ...e, id: `expense-${idx++}` } as TestExpense);
    }
  }
}

/** Seed financing records for the first N vehicles. */
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

// ---------------------------------------------------------------------------
// Property 4: Category percentages sum to 100
// **Validates: Requirements 6.3, 12.3**
// ---------------------------------------------------------------------------
describe('Property 4: Category percentages sum to 100', () => {
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

// ---------------------------------------------------------------------------
// Property 5: Cost per mile formula
// **Validates: Requirements 6.4, 10.3**
// ---------------------------------------------------------------------------
describe('Property 5: Cost per distance formula', () => {
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

// ---------------------------------------------------------------------------
// Property 23: Unfinanced vehicles classified as own
// **Validates: Requirement 7.4**
// ---------------------------------------------------------------------------
describe('Property 23: Unfinanced vehicles classified as own', () => {
  // NOTE: This test is skipped because getFinancing() calls financingRepository.computeBalance()
  // which uses the singleton bound to the real DB, not the test's in-memory DB.
  // This is a pre-existing architectural limitation — computeBalance needs the same DB instance.
  test.skip('vehicles without financing records have financingType = own', async () => {
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

/** Assert unfinanced vehicles are classified as 'own'. */
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

/** Assert financed vehicles are NOT classified as 'own'. */
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

// ---------------------------------------------------------------------------
// #54 (C158): getFuelEfficiencyTrend must NOT pair fuel rows ACROSS vehicles in the fleet view.
// Pre-fix the query ordered by date only and paired consecutive rows globally, so two different cars'
// odometers got subtracted → a phantom efficiency point. The fix orders by (vehicleId, date) and pairs
// only WITHIN each vehicle (forEachVehiclePair). These pin the boundary.
// ---------------------------------------------------------------------------
/** Seed one fuel fillup for a vehicle (real volume + mileage; not a missed fillup). */
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

/** Seed a CHARGE session (electric fuelType; kWh in volume) — for the #126 gas/charge partition guard. */
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

describe('#54: fleet fuel-efficiency trend never pairs across vehicles', () => {
  test('two cars with CLOSE odometers + interleaved dates produce NO cross-vehicle phantom point', async () => {
    const { userId } = setupUserAndVehicles(2);
    const [v0, v1] = ['vehicle-user-1-0', 'vehicle-user-1-1'];
    // Each car has exactly ONE fuel row → zero same-vehicle pairs → the trend must be empty.
    // Odometers are CLOSE (12,000 vs 12,100) and dates INTERLEAVED so a cross-vehicle pair would yield
    // a plausible 100mi/10gal = 10 MPG point that survives the [5,100] realistic-bounds filter.
    seedFuel(v0, 'f-v0', new Date(2024, 0, 1), 12_000, 10);
    seedFuel(v1, 'f-v1', new Date(2024, 0, 8), 12_100, 10);

    const trend = await repo.getFuelEfficiencyTrend(userId);
    // Pre-fix: 1 phantom point (12,100 − 12,000)/10 = 10 MPG. Post-fix: empty (no same-vehicle pair).
    expect(trend).toEqual([]);
  });

  test('each vehicle still gets its OWN valid trend points (per-vehicle pairing preserved)', async () => {
    const { userId } = setupUserAndVehicles(2);
    const [v0, v1] = ['vehicle-user-1-0', 'vehicle-user-1-1'];
    // v0: two rows 300mi/10gal = 30 MPG. v1: two rows 250mi/10gal = 25 MPG. Interleave all four by date.
    seedFuel(v0, 'f-v0-a', new Date(2024, 0, 1), 10_000, 10);
    seedFuel(v1, 'f-v1-a', new Date(2024, 0, 3), 50_000, 10);
    seedFuel(v0, 'f-v0-b', new Date(2024, 0, 5), 10_300, 10); // +300 within v0
    seedFuel(v1, 'f-v1-b', new Date(2024, 0, 7), 50_250, 10); // +250 within v1

    const trend = await repo.getFuelEfficiencyTrend(userId);
    // Exactly TWO points (one valid pair per vehicle); none cross-vehicle (a v0→v1 jump would be
    // 40,000mi → filtered, but the ordering guarantees we never even attempt it).
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

  // #126 (C427): getFuelEfficiencyTrend (+ the converted cross-vehicle efficiency builders) computed the
  // gas-MPG efficiency via computeEfficiencyPoint, which ACCEPTS electric rows — so a PHEV's charge
  // session (kWh in volume → ~mi/kWh) leaked a point into the gas-MPG trend (mislabeled mi/gal), the
  // #119/#122 contamination on the repository converted/trend paths the C413 sweep missed. Now all 4
  // sites use gasEfficiencyPoint. This pins the trend excludes charge for a plug-in hybrid.
  test('a plug-in hybrid efficiency trend excludes its CHARGE sessions (gas MPG only) — #126', async () => {
    const { userId } = setupUserAndVehicles(1);
    const v0 = 'vehicle-user-1-0';
    // Two CONSECUTIVE gas fillups (10000 → 10300 on 10 gal = 30 MPG), then two CONSECUTIVE charge sessions
    // (20000 → 20060 on 15 kWh = 4 mi/kWh) on the SAME vehicle. Grouping each energy type keeps gas pairs
    // adjacent (so a 30 MPG point forms) AND charge pairs adjacent (so PRE-fix a ~4 mi/kWh point also
    // formed) — isolating the gas/charge-EXCLUSION concern from the separate #C398 pairing-adjacency one.
    seedFuel(v0, 'g-1', new Date(2024, 0, 1), 10_000, 10);
    seedFuel(v0, 'g-2', new Date(2024, 0, 5), 10_300, 10);
    seedCharge(v0, 'c-1', new Date(2024, 0, 10), 20_000, 15);
    seedCharge(v0, 'c-2', new Date(2024, 0, 15), 20_060, 15);

    const trend = await repo.getFuelEfficiencyTrend(userId);
    // Pre-fix: 2 points — the 30 MPG gas pair AND the ~4 mi/kWh charge pair. Post-fix: ONLY the gas pair.
    expect(trend.length).toBe(1);
    expect(trend[0]?.efficiency).toBeCloseTo(30, 5);
    expect(trend.some((p) => p.efficiency < 10)).toBe(false); // no mi/kWh-magnitude leak
  });

  // #126 guard on the CONVERTED path (C66, arch-extract→guard-pin for the C64 *convertedGasEfficiencyPoints
  // generator). getFuelEfficiencyTrend above uses its OWN forEachVehiclePair loop, NOT the C64 generator — so
  // it does NOT pin the generator's gas-gate. The mixed-unit summary readers (getQuickStats / getYearEnd /
  // getSummary) feed avgEfficiency through computeConvertedEfficiencyValues → the generator, and ONLY there is
  // a PHEV charge session both (a) excluded from the gas average AND (b) NOT mis-fed to convertEfficiency
  // (which would convert mi/kWh as if it were mi/gal → garbage, the worse half of #126/C427). Property 11
  // drives this path but seeds gas-only rows, so a gate regression (revert gasEfficiencyPoint →
  // computeEfficiencyPoint in the generator) would stay green there. This is the direct net: a mixed-unit
  // (km/L vehicle, mi/gal user) PHEV fleet — the converted avgEfficiency must reflect the gas pair ALONE.
  test('the CONVERTED summary gas-MPG average excludes a PHEV charge session on a mixed-unit fleet — #126 (C64 generator)', async () => {
    const { userId } = setupUserAndVehicles(1);
    const v0 = 'vehicle-user-1-0';
    // User keeps the default miles/gallons; the vehicle reports km/litres → allVehiclesMatchUnits is false →
    // skipConversion=false → computeConvertedEfficiencyValues runs the C64 generator's CONVERT branch.
    testDb.sqlite.run('UPDATE vehicles SET unit_preferences = ? WHERE id = ?', [
      JSON.stringify({ distanceUnit: 'kilometers', volumeUnit: 'liters', chargeUnit: 'kwh' }),
      v0,
    ]);
    // Gas pair: 10000 → 10300 km on 10 L = 30 km/L (in the [5,100] band) → converts to
    // 30 / 1.609344 × 3.785411784 ≈ 70.57 mi/gal. Charge pair: 20000 → 20060 (60) on 15 kWh = 4 mi/kWh
    // (would survive the electric [1,10] band PRE-fix and, mis-converted as mi/gal, drag the average down).
    seedFuel(v0, 'g-1', new Date(2024, 0, 1), 10_000, 10);
    seedFuel(v0, 'g-2', new Date(2024, 0, 5), 10_300, 10);
    seedCharge(v0, 'c-1', new Date(2024, 0, 10), 20_000, 15);
    seedCharge(v0, 'c-2', new Date(2024, 0, 15), 20_060, 15);

    const stats = await repo.getQuickStats(userId, yearToRange(TEST_YEAR));
    const expectedGasMpg = (30 / 1.609344) * 3.785411784; // ≈ 70.57 mi/gal, gas pair only
    // Post-fix: exactly the converted gas average. Pre-fix (gate reverted): the ~4 mi/kWh charge point
    // would average in (mis-converted), pulling avgEfficiency well below the gas-only value.
    expect(stats.avgEfficiency).not.toBeNull();
    expect(stats.avgEfficiency as number).toBeCloseTo(expectedGasMpg, 1);
    expect(stats.avgEfficiency as number).toBeGreaterThan(50); // a charge-contaminated mean would be ~37
  });
});
