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

const USER = { id: 'user-prev', email: 'prev@test.com', displayName: 'Prev' };
const GAS = { id: 'veh-gas', userId: USER.id, make: 'Honda', model: 'Civic', year: 2020 };
const EV = { id: 'veh-ev', userId: USER.id, make: 'Kia', model: 'Niro EV', year: 2022 };

beforeEach(() => {
  testDb = createTestDb();
  repo = new AnalyticsRepository(testDb.drizzle);
  seedUser(testDb.sqlite, USER);
  seedVehicle(testDb.sqlite, GAS);
  seedVehicle(testDb.sqlite, EV);
});

afterEach(() => {
  testDb.sqlite.close();
});

function fuel(over: Partial<TestExpense> & Pick<TestExpense, 'id' | 'date'>): TestExpense {
  return {
    vehicleId: GAS.id,
    category: 'fuel',
    expenseAmount: 4000,
    mileage: null,
    volume: 10,
    fuelType: 'Regular',
    missedFillup: false,
    ...over,
  };
}

function seedFillups(year: number, startMileage: number, milesPer: number, cost: number): void {
  for (let m = 0; m < 4; m++) {
    seedExpense(
      testDb.sqlite,
      fuel({
        id: `g${year}-${m}`,
        date: new Date(Date.UTC(year, m * 3, 10)),
        mileage: startMileage + m * milesPer,
        expenseAmount: cost,
      })
    );
  }
}

describe('fuel stats previous window', () => {
  test('carries the previous window figures next to the current ones', async () => {
    seedFillups(2023, 10_000, 250, 4000);
    seedFillups(2024, 11_000, 300, 5000);
    seedExpense(
      testDb.sqlite,
      fuel({
        id: 'c2023',
        vehicleId: EV.id,
        date: new Date(Date.UTC(2023, 9, 12)),
        mileage: 2000,
        volume: 40,
        fuelType: 'Level 2 (AC)',
        expenseAmount: 1200,
      })
    );
    seedExpense(
      testDb.sqlite,
      fuel({
        id: 'c2023b',
        vehicleId: EV.id,
        date: new Date(Date.UTC(2023, 10, 12)),
        mileage: 2160,
        volume: 40,
        fuelType: 'Level 2 (AC)',
        expenseAmount: 1200,
      })
    );

    const { previous } = await repo.getFuelStats(USER.id, yearToRange(2024));

    expect(previous.costPerDistance).toBeCloseTo((4 * 4000 + 2 * 1200) / (750 + 160), 9);
    expect(previous.monthlySpend?.months).toBe(12);
    expect(previous.monthlySpend?.fuel).toBeCloseTo((4 * 4000) / 12, 9);
    expect(previous.monthlySpend?.charging).toBeCloseTo((2 * 1200) / 12, 9);
    expect(previous.avgEfficiency).toBeCloseTo(25, 9);
    expect(previous.chargeAvgEfficiency).toBeCloseTo(4, 9);
  });

  test('a user with no older data has no previous figures', async () => {
    seedFillups(2024, 11_000, 300, 5000);

    const { previous } = await repo.getFuelStats(USER.id, yearToRange(2024));

    expect(previous).toEqual({
      costPerDistance: null,
      monthlySpend: null,
      avgEfficiency: null,
      chargeAvgEfficiency: null,
    });
  });

  test('getSummary carries the same previous figures', async () => {
    seedFillups(2023, 10_000, 250, 4000);
    seedFillups(2024, 11_000, 300, 5000);

    const range = yearToRange(2024);
    const [summary, stats] = await Promise.all([
      repo.getSummary(USER.id, range),
      repo.getFuelStats(USER.id, range),
    ]);

    expect(summary.fuelStats.previous).toEqual(stats.previous);
  });
});
