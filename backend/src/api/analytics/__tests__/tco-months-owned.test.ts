/**
 * Unit net for monthsOwnedInYear (analytics/repository.ts), the C121/#28 fix: a YEAR-scoped TCO must
 * divide its windowed total by the months of THAT year the vehicle was owned (≤12), not by
 * full-ownership months purchaseDate→now. Pure function with an INJECTED `now` (no Date.now()), so the
 * assertions are host-independent — sidesteps the C77 UTC-host vacuity trap.
 *
 * (The companion behavior — purchasePrice is excluded from a year-scoped total — is asserted at the
 * source level by the includePurchase = !year gate; this unit pins the divisor math that pairs with it.)
 */

import { describe, expect, test } from 'bun:test';
import { calendarYearRange, monthsBetween, monthsOwnedInYear, toDate } from '../repository';

describe('monthsOwnedInYear — year-scoped ownership span (C121 #28)', () => {
  test('a vehicle owned for the WHOLE year counts 12 months', () => {
    // Bought before the year, still owned after it → all 12 months.
    expect(monthsOwnedInYear(new Date(2022, 5, 1), new Date(2025, 0, 1), 2024)).toBe(12);
  });

  test('a mid-year purchase counts only the owned months (Jul → Dec = 6)', () => {
    // Bought July 2024 (month index 6), now is later → Jul..Dec inclusive = 6.
    expect(monthsOwnedInYear(new Date(2024, 6, 10), new Date(2025, 3, 1), 2024)).toBe(6);
  });

  test('when `now` falls inside the scoped year, the span ends at the current month', () => {
    // Owned since 2023, now is March 2024 (month index 2) → Jan..Mar = 3.
    expect(monthsOwnedInYear(new Date(2023, 0, 1), new Date(2024, 2, 15), 2024)).toBe(3);
  });

  test('a future year (bought after it ends) counts 0', () => {
    expect(monthsOwnedInYear(new Date(2025, 0, 1), new Date(2025, 6, 1), 2024)).toBe(0);
  });

  test('a year entirely before ownership (now precedes the year) counts 0', () => {
    expect(monthsOwnedInYear(new Date(2026, 0, 1), new Date(2026, 5, 1), 2027)).toBe(0);
  });

  test('bought and queried within the same single month counts 1 (the divisor never collapses below the calling Math.max(1,…))', () => {
    // Jun 2024 → Jun 2024: month index 5 to 5 inclusive = 1.
    expect(monthsOwnedInYear(new Date(2024, 5, 5), new Date(2024, 5, 20), 2024)).toBe(1);
  });
});

// monthsBetween (C194-era helper): the signed `(year×12 + month-delta)` whole-calendar-months count
// behind TWO money-facing denominators — financing months-elapsed (Math.max(0,…)) and the all-time TCO
// cost-per-month divisor (Math.max(1,…)). Until now it was only IMPORTED + name-checked in a comment
// (per-vehicle.property.test.ts:574), never directly asserted — the C181/C229 "helper tested only in
// isolation" gap: a divergent reimplementation (a dropped `* 12`, a flipped subtraction) would turn NO
// test red. These pin the raw contract (the docstring's signed result; callers apply their own clamp),
// so a regression in the shared divisor can't slip through. Local getMonth/getFullYear, like the helper.
describe('monthsBetween — signed whole-calendar-months count (money divisor)', () => {
  test('a whole year apart counts 12 (the year×12 term)', () => {
    expect(monthsBetween(new Date(2023, 0, 15), new Date(2024, 0, 15))).toBe(12);
  });

  test('within the same month counts 0 (day-of-month is ignored — whole-month granularity)', () => {
    expect(monthsBetween(new Date(2024, 5, 1), new Date(2024, 5, 28))).toBe(0);
  });

  test('a few months forward in the same year counts the month delta (Mar → Sep = 6)', () => {
    expect(monthsBetween(new Date(2024, 2, 10), new Date(2024, 8, 10))).toBe(6);
  });

  test('crossing a year boundary sums year×12 + month-delta (Nov 2023 → Feb 2024 = 3)', () => {
    // (2024-2023)*12 + (1 - 10) = 12 - 9 = 3
    expect(monthsBetween(new Date(2023, 10, 1), new Date(2024, 1, 1))).toBe(3);
  });

  test('multi-year span (Jun 2020 → Jun 2024 = 48)', () => {
    expect(monthsBetween(new Date(2020, 5, 1), new Date(2024, 5, 1))).toBe(48);
  });

  test('is SIGNED — `to` before `from` yields a negative count (the documented raw contract)', () => {
    // The helper returns the raw signed value; the financing/cost-per-month callers clamp with their
    // own Math.max(0,…)/Math.max(1,…). Pin the negative so a future abs()/clamp creeping INTO the
    // helper (which would mask a caller's own clamp choice) turns this red.
    expect(monthsBetween(new Date(2024, 5, 1), new Date(2024, 2, 1))).toBe(-3);
  });
});

// toDate (C194 dedup): the `x instanceof Date ? x : new Date(x)` normalization the analytics builders
// hand-repeated at 4 sites (fuel monthly, financing startDate, term start+end), now one helper.
describe('toDate — normalize a Date-or-raw-timestamp into a Date', () => {
  test('passes an existing Date through by IDENTITY (no reconstruction)', () => {
    const d = new Date(2024, 5, 15, 10, 30);
    expect(toDate(d)).toBe(d); // same reference — the `instanceof Date` short-circuit
  });

  test('constructs a Date from an epoch-millis number', () => {
    const ms = Date.UTC(2024, 0, 2, 3, 4, 5);
    expect(toDate(ms).getTime()).toBe(ms);
  });

  test('constructs a Date from an ISO string', () => {
    const iso = '2024-03-15T12:00:00.000Z';
    expect(toDate(iso).getTime()).toBe(new Date(iso).getTime());
  });
});

// calendarYearRange (C216 dedup): the half-open [Jan1, nextJan1) Date pair the year filters
// (queryTotalSpending, year-scoped vehicle-expenses, getYearEnd) hand-repeated at 3 sites.
describe('calendarYearRange — half-open [Jan 1, next Jan 1) local boundaries', () => {
  test('start is Jan 1 of the year (local midnight), end is Jan 1 of the next year', () => {
    const { start, end } = calendarYearRange(2024);
    expect(start.getFullYear()).toBe(2024);
    expect(start.getMonth()).toBe(0);
    expect(start.getDate()).toBe(1);
    expect(end.getFullYear()).toBe(2025);
    expect(end.getMonth()).toBe(0);
    expect(end.getDate()).toBe(1);
  });

  test('the window is exactly one year wide and HALF-OPEN (Dec 31 23:59:59.999 is inside, end is not)', () => {
    const { start, end } = calendarYearRange(2024);
    // A leap year → 366 days between the two boundaries.
    const days = Math.round((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000));
    expect(days).toBe(366); // 2024 is a leap year
    // The last instant of the year is strictly before `end` (half-open upper bound).
    const lastInstant = new Date(2024, 11, 31, 23, 59, 59, 999);
    expect(lastInstant.getTime()).toBeLessThan(end.getTime());
    expect(lastInstant.getTime()).toBeGreaterThanOrEqual(start.getTime());
  });

  test('a non-leap year spans 365 days', () => {
    const { start, end } = calendarYearRange(2023);
    const days = Math.round((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000));
    expect(days).toBe(365);
  });
});
