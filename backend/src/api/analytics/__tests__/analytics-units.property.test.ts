import type { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import { ChargeUnit, DistanceUnit, type UnitPreferences, VolumeUnit } from '../../../types';
import { convertDistance, convertEfficiency } from '../../../utils/unit-conversions';
import type { CrossVehicleData } from '../repository';
import { AnalyticsRepository } from '../repository';
import {
  createTestDb,
  seedExpense,
  seedUser,
  type TestDb,
  type TestExpense,
  type TestVehicle,
  yearToRange,
} from './analytics-test-generators';

const distanceUnitArb = fc.constantFrom(DistanceUnit.MILES, DistanceUnit.KILOMETERS);
const volumeUnitArb = fc.constantFrom(
  VolumeUnit.GALLONS_US,
  VolumeUnit.GALLONS_UK,
  VolumeUnit.LITERS
);

const unitPreferencesArb: fc.Arbitrary<UnitPreferences> = fc.record({
  distanceUnit: distanceUnitArb,
  volumeUnit: volumeUnitArb,
  chargeUnit: fc.constant(ChargeUnit.KWH),
});

const mixedUnitPairArb: fc.Arbitrary<[UnitPreferences, UnitPreferences]> = fc
  .tuple(unitPreferencesArb, unitPreferencesArb)
  .filter(([a, b]) => a.distanceUnit !== b.distanceUnit || a.volumeUnit !== b.volumeUnit);

function seedUserSettings(db: Database, userId: string, units: UnitPreferences): void {
  db.run('INSERT INTO user_preferences (user_id, unit_preferences) VALUES (?, ?)', [
    userId,
    JSON.stringify(units),
  ]);
}

function seedVehicleWithUnits(db: Database, vehicle: TestVehicle, units: UnitPreferences): void {
  db.run(
    'INSERT INTO vehicles (id, user_id, make, model, year, unit_preferences) VALUES (?, ?, ?, ?, ?, ?)',
    [vehicle.id, vehicle.userId, vehicle.make, vehicle.model, vehicle.year, JSON.stringify(units)]
  );
}

function makeFuelExpense(
  vehicleId: string,
  index: number,
  mileage: number,
  volume: number,
  date: Date
): TestExpense {
  return {
    id: `expense-${vehicleId}-${index}`,
    vehicleId,
    category: 'fuel',
    expenseAmount: volume * 3.5,
    date,
    mileage,
    volume,
    fuelType: 'Regular',
    missedFillup: false,
  };
}

function makeTestVehicle(id: string, userId: string, make: string, model: string): TestVehicle {
  return { id, userId, make, model, year: 2022 };
}

function seedFuelExpensesForVehicle(
  db: Database,
  vehicleId: string,
  mileageIncrement: number,
  volume: number,
  baseMileage: number,
  dateOffsetMs: number
): void {
  const baseDate = new Date(TEST_YEAR, 3, 1);
  for (let i = 0; i < 3; i++) {
    const date = new Date(baseDate.getTime() + i * 30 * 86400000 + dateOffsetMs);
    seedExpense(
      db,
      makeFuelExpense(vehicleId, i, baseMileage + i * mileageIncrement * 100, volume, date)
    );
  }
}

function setupMixedUnitScenario(
  db: Database,
  userUnits: UnitPreferences,
  vehicleAUnits: UnitPreferences,
  vehicleBUnits: UnitPreferences
): { userId: string; vehicleA: TestVehicle; vehicleB: TestVehicle } {
  const userId = 'user-1';
  seedUser(db, { id: userId, email: 'test@test.com', displayName: 'Test' });
  seedUserSettings(db, userId, userUnits);

  const vehicleA = makeTestVehicle('vehicle-A', userId, 'Toyota', 'Camry');
  const vehicleB = makeTestVehicle('vehicle-B', userId, 'Honda', 'Civic');
  seedVehicleWithUnits(db, vehicleA, vehicleAUnits);
  seedVehicleWithUnits(db, vehicleB, vehicleBUnits);

  return { userId, vehicleA, vehicleB };
}

function assertUnitsMatch(
  units: { distanceUnit: string; volumeUnit: string; chargeUnit: string },
  expected: UnitPreferences
): void {
  expect(units.distanceUnit).toBe(expected.distanceUnit);
  expect(units.volumeUnit).toBe(expected.volumeUnit);
  expect(units.chargeUnit).toBe(expected.chargeUnit);
}

function assertCostPerDistance(
  comparison: CrossVehicleData['vehicleCostComparison'],
  vehicleId: string,
  mileageIncrement: number,
  vehicleUnits: UnitPreferences,
  userUnits: UnitPreferences
): void {
  const vc = comparison.find((v) => v.vehicleId === vehicleId);
  if (vc?.costPerDistance != null) {
    const rawDist = 2 * mileageIncrement * 100;
    const convertedDist = convertDistance(
      rawDist,
      vehicleUnits.distanceUnit,
      userUnits.distanceUnit
    );
    const expectedCpd = vc.totalCost / convertedDist;
    expect(vc.costPerDistance).toBeCloseTo(expectedCpd, 4);
  }
}

function assertEfficiencyConverted(
  fuelEfficiencyComparison: CrossVehicleData['fuelEfficiencyComparison'],
  vehicleId: string,
  mileageIncrement: number,
  volume: number,
  vehicleUnits: UnitPreferences,
  userUnits: UnitPreferences
): void {
  for (const monthEntry of fuelEfficiencyComparison) {
    const vEntry = monthEntry.vehicles.find((v) => v.vehicleId === vehicleId);
    if (!vEntry) continue;
    expect(vEntry.efficiency).toBeGreaterThan(0);
    const rawEff = (mileageIncrement * 100) / volume;
    const expectedEff = convertEfficiency(
      rawEff,
      vehicleUnits.distanceUnit,
      vehicleUnits.volumeUnit,
      userUnits.distanceUnit,
      userUnits.volumeUnit
    );
    expect(vEntry.efficiency).toBeCloseTo(expectedEff, 2);
  }
}

let testDb: TestDb;
let repo: AnalyticsRepository;
const TEST_YEAR = 2024;

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

describe('Cross-vehicle analytics conversion', () => {
  test('cross-vehicle aggregation converts values to user global units', async () => {
    await fc.assert(
      fc.asyncProperty(
        unitPreferencesArb,
        mixedUnitPairArb,
        fc.integer({ min: 10, max: 50 }),
        fc.integer({ min: 10, max: 50 }),
        fc.double({ min: 1, max: 20, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: 1, max: 20, noNaN: true, noDefaultInfinity: true }),
        async (userUnits, [vAUnits, vBUnits], mileIncrA, mileIncrB, fuelA, fuelB) => {
          resetDb();
          const { userId, vehicleA, vehicleB } = setupMixedUnitScenario(
            testDb.sqlite,
            userUnits,
            vAUnits,
            vBUnits
          );

          seedFuelExpensesForVehicle(testDb.sqlite, vehicleA.id, mileIncrA, fuelA, 1000, 0);
          seedFuelExpensesForVehicle(testDb.sqlite, vehicleB.id, mileIncrB, fuelB, 2000, 86400000);

          const result = await repo.getCrossVehicle(userId, yearToRange(TEST_YEAR));

          assertUnitsMatch(result.units, userUnits);

          for (const vc of result.vehicleCostComparison) {
            if (vc.costPerDistance !== null) {
              expect(vc.costPerDistance).toBeGreaterThan(0);
            }
          }

          assertCostPerDistance(
            result.vehicleCostComparison,
            vehicleA.id,
            mileIncrA,
            vAUnits,
            userUnits
          );
          assertCostPerDistance(
            result.vehicleCostComparison,
            vehicleB.id,
            mileIncrB,
            vBUnits,
            userUnits
          );
          assertEfficiencyConverted(
            result.fuelEfficiencyComparison,
            vehicleA.id,
            mileIncrA,
            fuelA,
            vAUnits,
            userUnits
          );
          assertEfficiencyConverted(
            result.fuelEfficiencyComparison,
            vehicleB.id,
            mileIncrB,
            fuelB,
            vBUnits,
            userUnits
          );
        }
      ),
      { numRuns: 100 }
    );
  });

  test('getQuickStats returns units matching user global preferences', async () => {
    await fc.assert(
      fc.asyncProperty(
        unitPreferencesArb,
        mixedUnitPairArb,
        async (userUnits, [vAUnits, vBUnits]) => {
          resetDb();
          const { userId, vehicleA, vehicleB } = setupMixedUnitScenario(
            testDb.sqlite,
            userUnits,
            vAUnits,
            vBUnits
          );

          seedFuelExpensesForVehicle(testDb.sqlite, vehicleA.id, 20, 10, 1000, 0);
          seedFuelExpensesForVehicle(testDb.sqlite, vehicleB.id, 30, 12, 5000, 86400000);

          const result = await repo.getQuickStats(userId, yearToRange(TEST_YEAR));

          assertUnitsMatch(result.units, userUnits);

          if (result.avgEfficiency !== null) {
            expect(result.avgEfficiency).toBeGreaterThan(0);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
