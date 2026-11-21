import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { zonedCalendar } from '../../../utils/analytics-charts';
import { zonedMidnight } from '../../../utils/time-zone';
import { AnalyticsRepository, calendarYearRange } from '../repository';
import {
  createTestDb,
  seedExpense,
  seedInsurancePolicy,
  seedInsuranceTermVehicle,
  seedUser,
  seedVehicle,
  type TestDb,
} from './analytics-test-generators';

let testDb: TestDb;
let repo: AnalyticsRepository;

const USER = { id: 'user-nz', email: 'nz@test.com', displayName: 'NZ' };
const VEHICLE = { id: 'veh-nz', userId: USER.id, make: 'Toyota', model: 'Aqua', year: 2021 };
const AUCKLAND = 'Pacific/Auckland';
const JAN_1_NOON_AUCKLAND = new Date('2024-12-31T23:00:00.000Z');
const seconds = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);
const WINDOW = {
  start: seconds('2024-06-01T00:00:00.000Z'),
  end: seconds('2025-03-01T00:00:00.000Z'),
};

beforeEach(() => {
  testDb = createTestDb();
  repo = new AnalyticsRepository(testDb.drizzle);
  seedUser(testDb.sqlite, USER);
  seedVehicle(testDb.sqlite, VEHICLE);
  seedExpense(testDb.sqlite, {
    id: 'fuel-jan-1',
    vehicleId: VEHICLE.id,
    category: 'fuel',
    expenseAmount: 6000,
    date: JAN_1_NOON_AUCKLAND,
    mileage: 20_000,
    volume: 40,
    fuelType: 'Regular',
    missedFillup: false,
  });
});

afterEach(() => testDb.sqlite.close());

describe('zoned calendar helpers', () => {
  test('Auckland local noon on Jan 1 is Jan 1 there and Dec 31 in UTC', () => {
    expect(zonedCalendar(AUCKLAND).day(JAN_1_NOON_AUCKLAND)).toBe('2025-01-01');
    expect(zonedCalendar(undefined).day(JAN_1_NOON_AUCKLAND)).toBe('2024-12-31');
  });

  test('zonedMidnight gives the instant local midnight starts, across DST', () => {
    expect(zonedMidnight(2025, 0, 1, AUCKLAND).toISOString()).toBe('2024-12-31T11:00:00.000Z');
    expect(zonedMidnight(2025, 6, 1, AUCKLAND).toISOString()).toBe('2025-06-30T12:00:00.000Z');
    expect(calendarYearRange(2025, zonedCalendar(AUCKLAND)).start.toISOString()).toBe(
      '2024-12-31T11:00:00.000Z'
    );
  });
});

describe('analytics bucket a UTC+13 user by their own calendar when timeZone is sent', () => {
  test('monthly trends and the day-of-week chart use the local day', async () => {
    const cross = await repo.getCrossVehicle(USER.id, WINDOW, AUCKLAND);
    expect(cross.monthlyExpenseTrends.map((m) => m.month)).toEqual(['2025-01']);

    const advanced = await repo.getFuelAdvanced(USER.id, WINDOW, undefined, AUCKLAND);
    const wednesday = advanced.dayOfWeekPatterns.find((d) => d.day === 'Wednesday');
    expect(wednesday?.fillupCount).toBe(1);
    expect(advanced.monthlyCostHeatmap.map((m) => m.month)).toEqual(['2025-01']);

    const utc = await repo.getCrossVehicle(USER.id, WINDOW);
    expect(utc.monthlyExpenseTrends.map((m) => m.month)).toEqual(['2024-12']);
  });

  test('the year-end report for 2025 includes the Jan 1 fill-up', async () => {
    const local = await repo.getYearEnd(USER.id, 2025, AUCKLAND);
    expect(local.totalSpent).toBe(6000);
    const utc = await repo.getYearEnd(USER.id, 2025);
    expect(utc.totalSpent).toBe(0);
  });

  test('an insurance term starting on local Jan 1 charts from January', async () => {
    seedInsurancePolicy(testDb.sqlite, {
      id: 'pol-nz',
      userId: USER.id,
      company: 'AMI',
      isActive: true,
    });
    testDb.sqlite.run(
      'INSERT INTO insurance_terms (id, policy_id, start_date, end_date, monthly_cost) VALUES (?, ?, ?, ?, ?)',
      [
        'term-nz',
        'pol-nz',
        seconds('2024-12-31T23:00:00.000Z'),
        seconds('2025-03-31T23:00:00.000Z'),
        100,
      ]
    );
    seedInsuranceTermVehicle(testDb.sqlite, { termId: 'term-nz', vehicleId: VEHICLE.id });

    const local = await repo.getInsurance(USER.id, AUCKLAND);
    expect(local.monthlyPremiumTrend.map((m) => m.month)).toEqual([
      '2025-01',
      '2025-02',
      '2025-03',
    ]);
  });
});
