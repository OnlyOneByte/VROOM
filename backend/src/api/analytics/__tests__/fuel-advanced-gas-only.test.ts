import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { AnalyticsRepository } from '../repository';
import {
  seedExpense,
  seedUser,
  seedVehicle,
  openAnalyticsTestDb,
  type AnalyticsTestDb,
} from './analytics-test-db';
import {
  type TestExpense,
  yearToRange,
} from './analytics-test-generators';

let testDb: AnalyticsTestDb;
let repo: AnalyticsRepository;

const USER = { id: 'user-gas', email: 'gas@test.com', displayName: 'Gas' };
const VEHICLE = { id: 'veh-1', userId: USER.id, make: 'Toyota', model: 'Prime', year: 2022 };

beforeEach(async () => {
  testDb = await openAnalyticsTestDb();
  repo = new AnalyticsRepository(testDb.asyncDb);
  await seedUser(testDb.sql, USER);
  await seedVehicle(testDb.sql, VEHICLE);
});

afterEach(() => {
  testDb.close();
});

function fuel(over: Partial<TestExpense> & Pick<TestExpense, 'id' | 'date'>): TestExpense {
  return {
    vehicleId: VEHICLE.id,
    category: 'fuel',
    expenseAmount: 40,
    mileage: null,
    volume: 10,
    fuelType: 'Regular',
    missedFillup: false,
    ...over,
  };
}

describe('PHEV charge sessions stay out of the gas-MPG averages', () => {
  beforeEach(async () => {
    await seedExpense(
      testDb.sql,
      fuel({ id: 'g1', date: new Date(Date.UTC(2024, 0, 1)), mileage: 10_000 })
    );
    await seedExpense(
      testDb.sql,
      fuel({ id: 'g2', date: new Date(Date.UTC(2024, 0, 8)), mileage: 10_300 })
    );
    await seedExpense(
      testDb.sql,
      fuel({
        id: 'c1',
        date: new Date(Date.UTC(2024, 0, 15)),
        mileage: 10_360,
        volume: 15,
        fuelType: 'Level 2 (AC)',
      })
    );
  });

  test('monthlyConsumption efficiency is the gas MPG', async () => {
    const stats = await repo.getFuelStats(USER.id, yearToRange(2024));
    const jan = stats.monthlyConsumption.find((m) => m.month === '2024-01');
    expect(jan?.efficiency).toBeCloseTo(30, 5);
  });

  test('seasonal avgEfficiency is the gas MPG', async () => {
    const adv = await repo.getFuelAdvanced(USER.id, yearToRange(2024));
    const winter = adv.seasonalEfficiency.find((s) => s.season === 'Winter');
    expect(winter?.avgEfficiency).toBeCloseTo(30, 5);
  });
});

describe('a split fuel expense counts as one fill-up', () => {
  test('seasonal and day-of-week fill-up counts skip volume-null siblings', async () => {
    const date = new Date(Date.UTC(2024, 0, 10));
    await seedExpense(testDb.sql, fuel({ id: 's1', date, volume: 10, expenseAmount: 20 }));
    await seedExpense(testDb.sql, fuel({ id: 's2', date, volume: null, expenseAmount: 20 }));

    const adv = await repo.getFuelAdvanced(USER.id, yearToRange(2024));
    const winter = adv.seasonalEfficiency.find((s) => s.season === 'Winter');
    const weekday = adv.dayOfWeekPatterns.find((d) => d.fillupCount > 0);

    expect(winter?.fillupCount).toBe(1);
    expect(adv.dayOfWeekPatterns.reduce((sum, d) => sum + d.fillupCount, 0)).toBe(1);
    expect(weekday?.avgVolume).toBe(10);
  });
});

describe('PHEV gas fill-ups pair with gas, and kWh stays out of fuel volume', () => {
  const CHARGE = 'Level 2 (AC)';

  beforeEach(async () => {
    await seedExpense(
      testDb.sql,
      fuel({ id: 'g1', date: new Date(Date.UTC(2024, 0, 1)), mileage: 10_000 })
    );
    await seedExpense(
      testDb.sql,
      fuel({
        id: 'c1',
        date: new Date(Date.UTC(2024, 0, 5)),
        mileage: 10_250,
        volume: 15,
        expenseAmount: 9,
        fuelType: CHARGE,
      })
    );
    await seedExpense(
      testDb.sql,
      fuel({ id: 'g2', date: new Date(Date.UTC(2024, 0, 8)), mileage: 10_300 })
    );
    await seedExpense(
      testDb.sql,
      fuel({ id: 'p1', date: new Date(Date.UTC(2023, 5, 1)), mileage: 5_000 })
    );
    await seedExpense(
      testDb.sql,
      fuel({
        id: 'pc',
        date: new Date(Date.UTC(2023, 5, 5)),
        mileage: 5_100,
        volume: 50,
        fuelType: CHARGE,
      })
    );
  });

  test('fuel stats count only gas fill-ups and gallons, and MPG is gas-to-gas', async () => {
    const stats = await repo.getFuelStats(USER.id, yearToRange(2024));
    expect(stats.fillups.currentYear).toBe(2);
    expect(stats.fillups.previousYear).toBe(1);
    expect(stats.volume.currentYear).toBeCloseTo(20, 9);
    expect(stats.volume.previousYear).toBeCloseTo(10, 9);
    expect(stats.fillupDetails.maxVolume).toBeCloseTo(10, 9);
    expect(stats.fuelConsumption.avgEfficiency).toBeCloseTo(30, 5);
    expect(stats.gasPriceHistory.map((g) => g.pricePerVolume)).toEqual([4, 4]);
  });

  test('fuel stats report charging separately in kWh', async () => {
    await seedExpense(
      testDb.sql,
      fuel({
        id: 'c2',
        date: new Date(2024, 0, 20),
        mileage: 10_310,
        volume: 15,
        expenseAmount: 6,
        fuelType: CHARGE,
      })
    );
    await seedExpense(
      testDb.sql,
      fuel({
        id: 'c3',
        date: new Date(2024, 0, 27),
        mileage: 10_370,
        volume: 15,
        expenseAmount: 6,
        fuelType: CHARGE,
      })
    );
    const stats = await repo.getFuelStats(USER.id, yearToRange(2024));
    const { charging } = stats;
    expect(charging.sessions.currentYear).toBe(3);
    expect(charging.sessions.previousYear).toBe(1);
    expect(charging.energy.currentYear).toBeCloseTo(45, 9);
    expect(charging.energy.previousYear).toBeCloseTo(50, 9);
    expect(charging.efficiency.avgEfficiency).toBeCloseTo(4, 9);
    expect(charging.averageCost.perSession).toBeCloseTo(7, 9);
    expect(charging.averageCost.perEnergyUnit).toBeCloseTo(21 / 45, 9);
    expect(charging.sessionDetails).toEqual({ avgEnergy: 15, minEnergy: 15, maxEnergy: 15 });
    expect(charging.priceHistory.map((p) => p.pricePerVolume)).toEqual([9 / 15, 6 / 15, 6 / 15]);
    expect(stats.gasPriceHistory.map((g) => g.pricePerVolume)).toEqual([4, 4]);
  });

  test('the vehicle fuel-efficiency trend uses the gas-to-gas interval', async () => {
    const points = await repo.getFuelEfficiencyTrend(USER.id, VEHICLE.id);
    expect(points.map((p) => p.efficiency)).toEqual([30]);
  });

  test('an electric vehicle trend uses the charge-to-charge interval', async () => {
    const EV = { id: 'veh-ev', userId: USER.id, make: 'Tesla', model: '3', year: 2023 };
    await seedVehicle(testDb.sql, EV);
    await testDb.sql.run("UPDATE vehicles SET vehicle_type = 'electric' WHERE id = ?", [EV.id]);
    const charge = { vehicleId: EV.id, volume: 20, fuelType: 'Level 2 (AC)' };
    await seedExpense(
      testDb.sql,
      fuel({ id: 'e1', date: new Date(Date.UTC(2024, 1, 1)), mileage: 500, ...charge })
    );
    await seedExpense(
      testDb.sql,
      fuel({ id: 'e2', date: new Date(Date.UTC(2024, 1, 8)), mileage: 580, ...charge })
    );

    const points = await repo.getFuelEfficiencyTrend(USER.id, EV.id);
    expect(points.map((p) => p.efficiency)).toEqual([4]);
  });

  test('vehicle expenses efficiency divides gas miles by gallons only', async () => {
    const data = await repo.getVehicleExpenses(USER.id, VEHICLE.id, yearToRange(2024));
    const jan = data.fuelEfficiencyAndCost.find((m) => m.month === '2024-01');
    expect(jan?.efficiency).toBeCloseTo(30, 5);
    expect(jan?.cost).toBe(89);
  });
});
