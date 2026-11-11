import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { AnalyticsRepository } from '../repository';
import {
  createTestDb,
  seedExpense,
  seedUser,
  seedVehicle,
  type TestDb,
  type TestExpense,
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

const USER = { id: 'user-fleet', email: 'fleet@test.com', displayName: 'Fleet' };
const VEH_A = { id: 'veh-a', userId: 'user-fleet', make: 'Toyota', model: 'A', year: 2022 };
const VEH_B = { id: 'veh-b', userId: 'user-fleet', make: 'Honda', model: 'B', year: 2022 };

function fillup(
  id: string,
  vehicleId: string,
  mileage: number,
  amount: number,
  daysAgo: number,
  volume: number
): TestExpense {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return {
    id,
    vehicleId,
    category: 'fuel',
    expenseAmount: amount,
    date: d,
    mileage,
    volume,
    fuelType: 'Regular',
    missedFillup: false,
  };
}

function rangeAll() {
  return {
    start: Math.floor(new Date(2020, 0, 1).getTime() / 1000),
    end: Math.floor(Date.now() / 1000) + 86_400,
  };
}

describe('fleet-wide fuel-stats pools per-vehicle distance by raw summation', () => {
  test('totalDistance is the SUM of each vehicle (max − min) span, not pooled across the whole fleet', async () => {
    seedUser(testDb.sqlite, USER);
    seedVehicle(testDb.sqlite, VEH_A);
    seedVehicle(testDb.sqlite, VEH_B);

    seedExpense(testDb.sqlite, fillup('a1', VEH_A.id, 10_000, 40, 60, 20));
    seedExpense(testDb.sqlite, fillup('a2', VEH_A.id, 10_800, 40, 30, 20));
    seedExpense(testDb.sqlite, fillup('b1', VEH_B.id, 50_000, 40, 60, 5));
    seedExpense(testDb.sqlite, fillup('b2', VEH_B.id, 50_200, 40, 30, 5));

    const stats = await repo.getFuelStats(USER.id, rangeAll());

    expect(stats.distance.totalDistance).toBe(1_000);
  });

  test('a MIXED mi+km fleet converts each span to the user unit before summing (no raw mi+km pool)', async () => {
    seedUser(testDb.sqlite, USER);
    seedVehicle(testDb.sqlite, VEH_A);
    seedVehicle(testDb.sqlite, VEH_B);
    testDb.sqlite.run('UPDATE vehicles SET unit_preferences = ? WHERE id = ?', [
      JSON.stringify({ distanceUnit: 'kilometers', volumeUnit: 'liters', chargeUnit: 'kwh' }),
      VEH_B.id,
    ]);

    seedExpense(testDb.sqlite, fillup('a1', VEH_A.id, 10_000, 40, 60, 20));
    seedExpense(testDb.sqlite, fillup('a2', VEH_A.id, 10_800, 40, 30, 20));
    seedExpense(testDb.sqlite, fillup('b1', VEH_B.id, 50_000, 40, 60, 5));
    seedExpense(testDb.sqlite, fillup('b2', VEH_B.id, 50_200, 40, 30, 5));

    const stats = await repo.getFuelStats(USER.id, rangeAll());

    expect(stats.distance.totalDistance).toBeCloseTo(800 + 200 / 1.609344, 2);
    expect(stats.distance.totalDistance).not.toBe(1_000);
  });

  test('volume.currentYear + fillupDetails pool gal/L by RAW summation across the fleet', async () => {
    seedUser(testDb.sqlite, USER);
    seedVehicle(testDb.sqlite, VEH_A);
    seedVehicle(testDb.sqlite, VEH_B);

    seedExpense(testDb.sqlite, fillup('a1', VEH_A.id, 10_000, 40, 60, 20));
    seedExpense(testDb.sqlite, fillup('a2', VEH_A.id, 10_800, 40, 30, 20));
    seedExpense(testDb.sqlite, fillup('b1', VEH_B.id, 50_000, 40, 60, 5));
    seedExpense(testDb.sqlite, fillup('b2', VEH_B.id, 50_200, 40, 30, 5));

    const stats = await repo.getFuelStats(USER.id, rangeAll());

    expect(stats.volume.currentYear).toBe(50);
    expect(stats.fillupDetails.avgVolume).toBeCloseTo(12.5, 5);
    expect(stats.fillupDetails.minVolume).toBe(5);
    expect(stats.fillupDetails.maxVolume).toBe(20);
  });

  test('a MIXED gal+L fleet converts each volume to the user unit before pooling (no raw gal+L sum)', async () => {
    seedUser(testDb.sqlite, USER);
    seedVehicle(testDb.sqlite, VEH_A);
    seedVehicle(testDb.sqlite, VEH_B);
    testDb.sqlite.run('UPDATE vehicles SET unit_preferences = ? WHERE id = ?', [
      JSON.stringify({ distanceUnit: 'miles', volumeUnit: 'liters', chargeUnit: 'kwh' }),
      VEH_B.id,
    ]);

    seedExpense(testDb.sqlite, fillup('a1', VEH_A.id, 10_000, 40, 60, 20));
    seedExpense(testDb.sqlite, fillup('a2', VEH_A.id, 10_800, 40, 30, 20));
    seedExpense(testDb.sqlite, fillup('b1', VEH_B.id, 50_000, 40, 60, 5));
    seedExpense(testDb.sqlite, fillup('b2', VEH_B.id, 50_200, 40, 30, 5));

    const stats = await repo.getFuelStats(USER.id, rangeAll());

    const litreToGal = 10 / 3.785411784;
    expect(stats.volume.currentYear).toBeCloseTo(40 + litreToGal, 2);
    expect(stats.volume.currentYear).not.toBe(50);
    expect(stats.fillupDetails.maxVolume).toBeCloseTo(20, 5);
    expect(stats.fillupDetails.minVolume).toBeCloseTo(5 / 3.785411784, 2);
  });

  test('volume.previousYear converts each vehicle prev-window sum to the user unit before pooling (mixed gal+L)', async () => {
    seedUser(testDb.sqlite, USER);
    seedVehicle(testDb.sqlite, VEH_A);
    seedVehicle(testDb.sqlite, VEH_B);
    testDb.sqlite.run('UPDATE vehicles SET unit_preferences = ? WHERE id = ?', [
      JSON.stringify({ distanceUnit: 'miles', volumeUnit: 'liters', chargeUnit: 'kwh' }),
      VEH_B.id,
    ]);

    const d2023 = (mo: number, day: number): TestExpense => ({
      id: `p-${mo}-${day}`,
      vehicleId: VEH_A.id,
      category: 'fuel',
      expenseAmount: 40,
      date: new Date(2023, mo, day),
      mileage: 10_000 + mo * 100,
      volume: 20,
      fuelType: 'Regular',
      missedFillup: false,
    });
    seedExpense(testDb.sqlite, d2023(2, 1));
    seedExpense(testDb.sqlite, d2023(5, 1));
    seedExpense(testDb.sqlite, {
      id: 'p-b1',
      vehicleId: VEH_B.id,
      category: 'fuel',
      expenseAmount: 40,
      date: new Date(2023, 2, 2),
      mileage: 50_000,
      volume: 5,
      fuelType: 'Regular',
      missedFillup: false,
    });
    seedExpense(testDb.sqlite, {
      id: 'p-b2',
      vehicleId: VEH_B.id,
      category: 'fuel',
      expenseAmount: 40,
      date: new Date(2023, 5, 2),
      mileage: 50_200,
      volume: 5,
      fuelType: 'Regular',
      missedFillup: false,
    });

    const range = {
      start: Math.floor(new Date(2024, 0, 1).getTime() / 1000),
      end: Math.floor(new Date(2025, 0, 1).getTime() / 1000),
    };
    const stats = await repo.getFuelStats(USER.id, range);

    expect(stats.volume.previousYear).toBeCloseTo(40 + 10 / 3.785411784, 2);
    expect(stats.volume.previousYear).not.toBeCloseTo(50, 1);
  });

  test('fillups.previousYear excludes volume-null split siblings', async () => {
    seedUser(testDb.sqlite, USER);
    seedVehicle(testDb.sqlite, VEH_A);
    seedVehicle(testDb.sqlite, VEH_B);

    seedExpense(testDb.sqlite, {
      id: 'py-real-a',
      vehicleId: VEH_A.id,
      category: 'fuel',
      expenseAmount: 40,
      date: new Date(2023, 2, 10),
      mileage: 10_000,
      volume: 10,
      fuelType: 'Regular',
      missedFillup: false,
    });
    seedExpense(testDb.sqlite, {
      id: 'py-real-b',
      vehicleId: VEH_B.id,
      category: 'fuel',
      expenseAmount: 38,
      date: new Date(2023, 2, 12),
      mileage: 50_000,
      volume: 9,
      fuelType: 'Regular',
      missedFillup: false,
    });
    seedExpense(testDb.sqlite, {
      id: 'py-split-a',
      vehicleId: VEH_A.id,
      category: 'fuel',
      expenseAmount: 12.5,
      date: new Date(2023, 4, 1),
      mileage: null,
      volume: null,
      fuelType: null,
      missedFillup: false,
    });
    seedExpense(testDb.sqlite, {
      id: 'py-split-b',
      vehicleId: VEH_B.id,
      category: 'fuel',
      expenseAmount: 12.5,
      date: new Date(2023, 4, 1),
      mileage: null,
      volume: null,
      fuelType: null,
      missedFillup: false,
    });

    const range = {
      start: Math.floor(new Date(2024, 0, 1).getTime() / 1000),
      end: Math.floor(new Date(2025, 0, 1).getTime() / 1000),
    };
    const stats = await repo.getFuelStats(USER.id, range);

    expect(stats.fillups.previousYear).toBe(2);
    expect(stats.volume.previousYear).toBe(19);
  });

  test('monthlyConsumption volume is converted to the user unit before pooling on a MIXED gal+L fleet (no raw gal+L sum)', async () => {
    seedUser(testDb.sqlite, USER);
    seedVehicle(testDb.sqlite, VEH_A);
    seedVehicle(testDb.sqlite, VEH_B);
    testDb.sqlite.run('UPDATE vehicles SET unit_preferences = ? WHERE id = ?', [
      JSON.stringify({ distanceUnit: 'miles', volumeUnit: 'liters', chargeUnit: 'kwh' }),
      VEH_B.id,
    ]);

    seedExpense(testDb.sqlite, fillup('a1', VEH_A.id, 10_000, 40, 60, 20));
    seedExpense(testDb.sqlite, fillup('a2', VEH_A.id, 10_800, 40, 30, 20));
    seedExpense(testDb.sqlite, fillup('b1', VEH_B.id, 50_000, 40, 60, 5));
    seedExpense(testDb.sqlite, fillup('b2', VEH_B.id, 50_200, 40, 30, 5));

    const stats = await repo.getFuelStats(USER.id, rangeAll());
    const totalVolume = stats.monthlyConsumption.reduce((s, m) => s + m.volume, 0);

    expect(totalVolume).toBeCloseTo(40 + 10 / 3.785411784, 2);
    expect(totalVolume).not.toBeCloseTo(50, 1);
  });

  test('best/worst cost-per-distance span the per-pair values across the WHOLE fleet (un-normalized scalars)', async () => {
    seedUser(testDb.sqlite, USER);
    seedVehicle(testDb.sqlite, VEH_A);
    seedVehicle(testDb.sqlite, VEH_B);

    seedExpense(testDb.sqlite, fillup('a1', VEH_A.id, 10_000, 40, 60, 20));
    seedExpense(testDb.sqlite, fillup('a2', VEH_A.id, 10_800, 40, 30, 20));
    seedExpense(testDb.sqlite, fillup('b1', VEH_B.id, 50_000, 40, 60, 5));
    seedExpense(testDb.sqlite, fillup('b2', VEH_B.id, 50_200, 40, 30, 5));

    const stats = await repo.getFuelStats(USER.id, rangeAll());

    expect(stats.averageCost.bestCostPerDistance).toBeCloseTo(0.05, 5);
    expect(stats.averageCost.worstCostPerDistance).toBeCloseTo(0.2, 5);
  });

  test('seasonal avgEfficiency converts each gas pair to the user unit before pooling on a MIXED mi/gal+km/L fleet', async () => {
    seedUser(testDb.sqlite, USER);
    seedVehicle(testDb.sqlite, VEH_A);
    seedVehicle(testDb.sqlite, VEH_B);
    testDb.sqlite.run('UPDATE vehicles SET unit_preferences = ? WHERE id = ?', [
      JSON.stringify({ distanceUnit: 'kilometers', volumeUnit: 'liters', chargeUnit: 'kwh' }),
      VEH_B.id,
    ]);

    const jan = (day: number) => new Date(2024, 0, day);
    const fuelOn = (
      id: string,
      vid: string,
      mileage: number,
      vol: number,
      day: number
    ): TestExpense => ({
      id,
      vehicleId: vid,
      category: 'fuel',
      expenseAmount: 50,
      date: jan(day),
      mileage,
      volume: vol,
      fuelType: 'Regular',
      missedFillup: false,
    });
    seedExpense(testDb.sqlite, fuelOn('a1', VEH_A.id, 10_000, 10, 5));
    seedExpense(testDb.sqlite, fuelOn('a2', VEH_A.id, 10_300, 10, 10));
    seedExpense(testDb.sqlite, fuelOn('b1', VEH_B.id, 50_000, 8, 6));
    seedExpense(testDb.sqlite, fuelOn('b2', VEH_B.id, 50_320, 8, 11));

    const adv = await repo.getFuelAdvanced(USER.id, rangeAll());
    const winter = adv.seasonalEfficiency.find((s) => s.season === 'Winter');
    const expectedConvertedB = (40 / 1.609344) * 3.785411784;
    const expectedAvg = (30 + expectedConvertedB) / 2;

    expect(winter?.avgEfficiency).toBeCloseTo(expectedAvg, 1);
    expect(winter?.avgEfficiency).not.toBeCloseTo(35, 0);
    expect(winter?.fillupCount).toBe(4);
  });

  test('dayOfWeek avgVolume converts each fillup volume to the user unit before pooling on a MIXED gal+L fleet', async () => {
    seedUser(testDb.sqlite, USER);
    seedVehicle(testDb.sqlite, VEH_A);
    seedVehicle(testDb.sqlite, VEH_B);
    testDb.sqlite.run('UPDATE vehicles SET unit_preferences = ? WHERE id = ?', [
      JSON.stringify({ distanceUnit: 'miles', volumeUnit: 'liters', chargeUnit: 'kwh' }),
      VEH_B.id,
    ]);

    const mon = (day: number) => new Date(2024, 0, day);
    const fuelOn = (
      id: string,
      vid: string,
      mileage: number,
      vol: number,
      day: number
    ): TestExpense => ({
      id,
      vehicleId: vid,
      category: 'fuel',
      expenseAmount: 50,
      date: mon(day),
      mileage,
      volume: vol,
      fuelType: 'Regular',
      missedFillup: false,
    });
    seedExpense(testDb.sqlite, fuelOn('a1', VEH_A.id, 10_000, 10, 1));
    seedExpense(testDb.sqlite, fuelOn('a2', VEH_A.id, 10_300, 10, 8));
    seedExpense(testDb.sqlite, fuelOn('b1', VEH_B.id, 50_000, 8, 15));
    seedExpense(testDb.sqlite, fuelOn('b2', VEH_B.id, 50_320, 8, 22));

    const adv = await repo.getFuelAdvanced(USER.id, rangeAll());
    const monday = adv.dayOfWeekPatterns.find((d) => d.day === 'Monday');
    const litreToGal = 8 / 3.785411784;
    const expectedAvgVolume = (10 + 10 + litreToGal + litreToGal) / 4;

    expect(monday?.avgVolume).toBeCloseTo(expectedAvgVolume, 2);
    expect(monday?.avgVolume).not.toBeCloseTo(9, 1);
    expect(monday?.fillupCount).toBe(4);
    expect(monday?.avgCost).toBeCloseTo(50, 5);
  });

  test('vehicleRadar fuelEfficiency normalizes CONVERTED gas-MPG so a mixed mi/gal+km/L fleet ranks like-with-like', async () => {
    seedUser(testDb.sqlite, USER);
    seedVehicle(testDb.sqlite, VEH_A);
    seedVehicle(testDb.sqlite, VEH_B);
    testDb.sqlite.run('UPDATE vehicles SET unit_preferences = ? WHERE id = ?', [
      JSON.stringify({ distanceUnit: 'kilometers', volumeUnit: 'liters', chargeUnit: 'kwh' }),
      VEH_B.id,
    ]);

    seedExpense(testDb.sqlite, fillup('a1', VEH_A.id, 10_000, 40, 60, 10));
    seedExpense(testDb.sqlite, fillup('a2', VEH_A.id, 10_300, 40, 30, 10));
    seedExpense(testDb.sqlite, fillup('b1', VEH_B.id, 50_000, 40, 60, 20));
    seedExpense(testDb.sqlite, fillup('b2', VEH_B.id, 50_360, 40, 30, 20));

    const adv = await repo.getFuelAdvanced(USER.id, rangeAll());
    const a = adv.vehicleRadar.find((r) => r.vehicleId === VEH_A.id);
    const b = adv.vehicleRadar.find((r) => r.vehicleId === VEH_B.id);

    expect(b?.fuelEfficiency).toBe(100);
    expect(a?.fuelEfficiency).toBe(0);
    expect(a?.fuelEfficiency).not.toBe(100);
  });

  test('year-end efficiencyTrend, avgEfficiency and totalDistance convert each vehicle before pooling on a MIXED mi/gal+km/L fleet', async () => {
    seedUser(testDb.sqlite, USER);
    seedVehicle(testDb.sqlite, VEH_A);
    seedVehicle(testDb.sqlite, VEH_B);
    testDb.sqlite.run('UPDATE vehicles SET unit_preferences = ? WHERE id = ?', [
      JSON.stringify({ distanceUnit: 'kilometers', volumeUnit: 'liters', chargeUnit: 'kwh' }),
      VEH_B.id,
    ]);
    const jan = (day: number) => new Date(2024, 0, day);
    const fuelOn = (id: string, vid: string, mileage: number, vol: number, day: number) => ({
      id,
      vehicleId: vid,
      category: 'fuel',
      expenseAmount: 50,
      date: jan(day),
      mileage,
      volume: vol,
      fuelType: 'Regular',
      missedFillup: false,
    });
    seedExpense(testDb.sqlite, fuelOn('a1', VEH_A.id, 10_000, 10, 5));
    seedExpense(testDb.sqlite, fuelOn('a2', VEH_A.id, 10_300, 10, 10));
    seedExpense(testDb.sqlite, fuelOn('b1', VEH_B.id, 50_000, 8, 6));
    seedExpense(testDb.sqlite, fuelOn('b2', VEH_B.id, 50_320, 8, 11));

    const ye = await repo.getYearEnd(USER.id, 2024);
    const expectedAvg = (30 + (40 / 1.609344) * 3.785411784) / 2;

    expect(ye.avgEfficiency).toBeCloseTo(expectedAvg, 1);
    expect(ye.efficiencyTrend).toHaveLength(1);
    expect(ye.efficiencyTrend[0]?.efficiency).toBeCloseTo(expectedAvg, 1);
    expect(ye.totalDistance).toBeCloseTo(300 + 320 / 1.609344, 1);
  });

  test('summary converts the same as the standalone getters on a MIXED fleet', async () => {
    seedUser(testDb.sqlite, USER);
    seedVehicle(testDb.sqlite, VEH_A);
    seedVehicle(testDb.sqlite, VEH_B);
    testDb.sqlite.run('UPDATE vehicles SET unit_preferences = ? WHERE id = ?', [
      JSON.stringify({ distanceUnit: 'kilometers', volumeUnit: 'liters', chargeUnit: 'kwh' }),
      VEH_B.id,
    ]);
    seedExpense(testDb.sqlite, fillup('a1', VEH_A.id, 10_000, 40, 60, 10));
    seedExpense(testDb.sqlite, fillup('a2', VEH_A.id, 10_300, 40, 30, 10));
    seedExpense(testDb.sqlite, fillup('b1', VEH_B.id, 50_000, 40, 60, 20));
    seedExpense(testDb.sqlite, fillup('b2', VEH_B.id, 50_360, 40, 30, 20));

    const summary = await repo.getSummary(USER.id, rangeAll());
    const [quick, stats, adv] = await Promise.all([
      repo.getQuickStats(USER.id, rangeAll()),
      repo.getFuelStats(USER.id, rangeAll()),
      repo.getFuelAdvanced(USER.id, rangeAll()),
    ]);

    expect(summary.quickStats.avgEfficiency).toBeCloseTo(quick.avgEfficiency ?? Number.NaN, 6);
    expect(summary.fuelStats.distance.totalDistance).toBeCloseTo(stats.distance.totalDistance, 6);
    expect(summary.fuelStats.volume.currentYear).toBeCloseTo(stats.volume.currentYear, 6);
    expect(summary.fuelAdvanced.seasonalEfficiency).toEqual(adv.seasonalEfficiency);
    expect(stats.distance.totalDistance).toBeCloseTo(300 + 360 / 1.609344, 1);
  });
});
