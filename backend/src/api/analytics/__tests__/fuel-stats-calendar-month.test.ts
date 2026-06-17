/**
 * Regression for #86 (C262): fuel-stats "This Month" / "Last Month" must be CALENDAR months —
 * matching BOTH month AND year — not a year-agnostic getMonth() match.
 *
 * buildFuelStatsFromData filtered currentMonth/prevMonth fillups + gallons on getMonth() alone.
 * fuelRows spans the entire requested range (the default 'all' view is multi-year), so a fillup
 * from the SAME calendar month in a PRIOR year was folded into "This Month" — e.g. with three
 * years of January data the "This Month" figure triple-counted (NORTH_STAR #2, correct-for-everyone:
 * the FE labels these "This Month"/"Last Month", true calendar months, alongside the also-now-derived
 * currentMonth). This pins the year-scoping (incl. the January → previous-year rollover for "Last Month").
 *
 * Dates are derived RELATIVE to `now` so the test is host/run-date independent.
 */

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

/**
 * A fuel fillup on the 1st of the given year+month, at 00:00. Day 1 (not mid-month) so the
 * CURRENT-month fillup is always already in the past relative to `now` (any day-of-month >= 1),
 * keeping it inside the [start, now] range regardless of which day the test runs.
 */
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

/** A DateRange (unix seconds) spanning [startYear-01-01, now] — the multi-year 'all'-style view. */
function rangeFrom(startYear: number) {
  return {
    start: Math.floor(new Date(startYear, 0, 1).getTime() / 1000),
    end: Math.floor(Date.now() / 1000) + 86_400, // +1 day so "now" is inside the range
  };
}

describe('#86 — fuel-stats This/Last Month are calendar months (year-scoped)', () => {
  test('a prior-year same-month fillup does NOT contaminate "This Month"', async () => {
    const now = new Date();
    const curMonth = now.getMonth();
    const curYear = now.getFullYear();

    seedUser(testDb.sqlite, USER);
    seedVehicle(testDb.sqlite, VEHICLE);

    // One fillup THIS calendar month (counts), one in the SAME month a year ago (must NOT count),
    // and one two years ago (must NOT count) — all in-range under the multi-year window.
    seedExpense(testDb.sqlite, fillup('cur', curYear, curMonth, 10));
    seedExpense(testDb.sqlite, fillup('prev-yr', curYear - 1, curMonth, 99));
    seedExpense(testDb.sqlite, fillup('two-yr', curYear - 2, curMonth, 99));

    const stats = await repo.getFuelStats(USER.id, rangeFrom(curYear - 3));

    // Only the current-calendar-month fillup counts toward "This Month".
    expect(stats.fillups.currentMonth).toBe(1);
    expect(stats.volume.currentMonth).toBeCloseTo(10, 5);
    // currentYear (range-relative, the #85-gated figure) still sees ALL three fillups.
    expect(stats.fillups.currentYear).toBe(3);
  });

  test('"Last Month" rolls into the previous YEAR when now is January', async () => {
    const now = new Date();
    const curMonth = now.getMonth();
    const curYear = now.getFullYear();

    // The calendar month before now, with its correct year (Jan → Dec of last year).
    const prevMonth = curMonth === 0 ? 11 : curMonth - 1;
    const prevMonthYear = curMonth === 0 ? curYear - 1 : curYear;

    seedUser(testDb.sqlite, USER);
    seedVehicle(testDb.sqlite, VEHICLE);

    // One fillup in the true previous calendar month (counts as Last Month), and one in that same
    // month-number but the WRONG year (prevMonthYear - 1) which must be excluded.
    seedExpense(testDb.sqlite, fillup('last', prevMonthYear, prevMonth, 7));
    seedExpense(testDb.sqlite, fillup('wrong-yr', prevMonthYear - 1, prevMonth, 99));

    const stats = await repo.getFuelStats(USER.id, rangeFrom(prevMonthYear - 2));

    expect(stats.fillups.previousMonth).toBe(1);
    expect(stats.volume.previousMonth).toBeCloseTo(7, 5);
  });
});
