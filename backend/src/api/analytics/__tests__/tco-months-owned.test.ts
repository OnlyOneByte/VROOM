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
import { monthsOwnedInYear, toDate } from '../repository';

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
