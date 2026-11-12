import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { AnalyticsRepository } from '../repository';
import {
  createTestDb,
  seedExpense,
  seedUser,
  seedVehicle,
  type TestDb,
  type TestExpense,
  yearToRange,
} from './analytics-test-generators';

let testDb: TestDb;
let repo: AnalyticsRepository;

const USER = { id: 'user-gas', email: 'gas@test.com', displayName: 'Gas' };
const VEHICLE = { id: 'veh-1', userId: USER.id, make: 'Toyota', model: 'Prime', year: 2022 };

beforeEach(() => {
  testDb = createTestDb();
  repo = new AnalyticsRepository(testDb.drizzle);
  seedUser(testDb.sqlite, USER);
  seedVehicle(testDb.sqlite, VEHICLE);
});

afterEach(() => {
  testDb.sqlite.close();
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
  beforeEach(() => {
    seedExpense(testDb.sqlite, fuel({ id: 'g1', date: new Date(2024, 0, 1), mileage: 10_000 }));
    seedExpense(testDb.sqlite, fuel({ id: 'g2', date: new Date(2024, 0, 8), mileage: 10_300 }));
    seedExpense(
      testDb.sqlite,
      fuel({
        id: 'c1',
        date: new Date(2024, 0, 15),
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
    const date = new Date(2024, 0, 10);
    seedExpense(testDb.sqlite, fuel({ id: 's1', date, volume: 10, expenseAmount: 20 }));
    seedExpense(testDb.sqlite, fuel({ id: 's2', date, volume: null, expenseAmount: 20 }));

    const adv = await repo.getFuelAdvanced(USER.id, yearToRange(2024));
    const winter = adv.seasonalEfficiency.find((s) => s.season === 'Winter');
    const weekday = adv.dayOfWeekPatterns.find((d) => d.fillupCount > 0);

    expect(winter?.fillupCount).toBe(1);
    expect(adv.dayOfWeekPatterns.reduce((sum, d) => sum + d.fillupCount, 0)).toBe(1);
    expect(weekday?.avgVolume).toBe(10);
  });
});
