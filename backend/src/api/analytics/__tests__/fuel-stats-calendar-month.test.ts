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

const USER = { id: 'user-1', email: 'cal@test.com', displayName: 'Cal' };
const VEHICLE = { id: 'veh-1', userId: 'user-1', make: 'Toyota', model: 'Camry', year: 2022 };

function fillup(id: string, year: number, month: number, volume: number): TestExpense {
  return {
    id,
    vehicleId: VEHICLE.id,
    category: 'fuel',
    expenseAmount: 50,
    date: new Date(year, month, 1, 0, 0, 0),
    mileage: null,
    volume,
    fuelType: 'Regular',
    missedFillup: false,
  };
}

function rangeFrom(startYear: number) {
  return {
    start: Math.floor(new Date(startYear, 0, 1).getTime() / 1000),
    end: Math.floor(Date.now() / 1000) + 86_400,
  };
}

describe('fuel-stats This/Last Month are calendar months (year-scoped)', () => {
  test('a prior-year same-month fillup does NOT contaminate "This Month"', async () => {
    const now = new Date();
    const curMonth = now.getMonth();
    const curYear = now.getFullYear();

    seedUser(testDb.sqlite, USER);
    seedVehicle(testDb.sqlite, VEHICLE);

    seedExpense(testDb.sqlite, fillup('cur', curYear, curMonth, 10));
    seedExpense(testDb.sqlite, fillup('prev-yr', curYear - 1, curMonth, 99));
    seedExpense(testDb.sqlite, fillup('two-yr', curYear - 2, curMonth, 99));

    const stats = await repo.getFuelStats(USER.id, rangeFrom(curYear - 3));

    expect(stats.fillups.currentMonth).toBe(1);
    expect(stats.volume.currentMonth).toBeCloseTo(10, 5);
    expect(stats.fillups.currentYear).toBe(3);
  });

  test('"Last Month" rolls into the previous YEAR when now is January', async () => {
    const now = new Date();
    const curMonth = now.getMonth();
    const curYear = now.getFullYear();

    const prevMonth = curMonth === 0 ? 11 : curMonth - 1;
    const prevMonthYear = curMonth === 0 ? curYear - 1 : curYear;

    seedUser(testDb.sqlite, USER);
    seedVehicle(testDb.sqlite, VEHICLE);

    seedExpense(testDb.sqlite, fillup('last', prevMonthYear, prevMonth, 7));
    seedExpense(testDb.sqlite, fillup('wrong-yr', prevMonthYear - 1, prevMonth, 99));

    const stats = await repo.getFuelStats(USER.id, rangeFrom(prevMonthYear - 2));

    expect(stats.fillups.previousMonth).toBe(1);
    expect(stats.volume.previousMonth).toBeCloseTo(7, 5);
  });
});
