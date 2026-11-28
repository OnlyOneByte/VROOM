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
} from './analytics-test-generators';

let testDb: AnalyticsTestDb;
let repo: AnalyticsRepository;

beforeEach(async () => {
  testDb = await openAnalyticsTestDb();
  repo = new AnalyticsRepository(testDb.asyncDb);
});

afterEach(() => {
  testDb.close();
});

const USER = { id: 'user-1', email: 'cal@test.com', displayName: 'Cal' };
const VEHICLE = { id: 'veh-1', userId: 'user-1', make: 'Toyota', model: 'Camry', year: 2022 };

function fillup(id: string, year: number, month: number, volume: number): TestExpense {
  return {
    id,
    vehicleId: VEHICLE.id,
    category: 'fuel',
    expenseAmount: 50,
    date: new Date(Date.UTC(year, month, 1, 0, 0, 0)),
    mileage: null,
    volume,
    fuelType: 'Regular',
    missedFillup: false,
  };
}

function rangeFrom(startYear: number) {
  return {
    start: Math.floor(new Date(Date.UTC(startYear, 0, 1)).getTime() / 1000),
    end: Math.floor(Date.now() / 1000) + 86_400,
  };
}

describe('fuel-stats This/Last Month are calendar months (year-scoped)', () => {
  test('a prior-year same-month fillup does NOT contaminate "This Month"', async () => {
    const now = new Date();
    const curMonth = now.getUTCMonth();
    const curYear = now.getUTCFullYear();

    await seedUser(testDb.sql, USER);
    await seedVehicle(testDb.sql, VEHICLE);

    await seedExpense(testDb.sql, fillup('cur', curYear, curMonth, 10));
    await seedExpense(testDb.sql, fillup('prev-yr', curYear - 1, curMonth, 99));
    await seedExpense(testDb.sql, fillup('two-yr', curYear - 2, curMonth, 99));

    const stats = await repo.getFuelStats(USER.id, rangeFrom(curYear - 3));

    expect(stats.fillups.currentMonth).toBe(1);
    expect(stats.volume.currentMonth).toBeCloseTo(10, 5);
    expect(stats.fillups.currentYear).toBe(3);
  });

  test('"Last Month" rolls into the previous YEAR when now is January', async () => {
    const now = new Date();
    const curMonth = now.getUTCMonth();
    const curYear = now.getUTCFullYear();

    const prevMonth = curMonth === 0 ? 11 : curMonth - 1;
    const prevMonthYear = curMonth === 0 ? curYear - 1 : curYear;

    await seedUser(testDb.sql, USER);
    await seedVehicle(testDb.sql, VEHICLE);

    await seedExpense(testDb.sql, fillup('last', prevMonthYear, prevMonth, 7));
    await seedExpense(testDb.sql, fillup('wrong-yr', prevMonthYear - 1, prevMonth, 99));

    const stats = await repo.getFuelStats(USER.id, rangeFrom(prevMonthYear - 2));

    expect(stats.fillups.previousMonth).toBe(1);
    expect(stats.volume.previousMonth).toBeCloseTo(7, 5);
  });
});
