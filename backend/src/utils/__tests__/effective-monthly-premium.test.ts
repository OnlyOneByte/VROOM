/**
 * effectiveMonthlyPremium (bug #8, cycle 23).
 *
 * An insurance term may record cost as a recurring monthlyCost OR a lump-sum totalCost. The old
 * premium math (`monthlyCost ?? 0`) silently contributed $0 for every totalCost-only term, zeroing
 * its premium total and trend. These tests pin the amortization: monthlyCost wins when set,
 * otherwise totalCost is spread across the term's month span (inclusive, day-1 anchored).
 */

import { describe, expect, test } from 'bun:test';
import { effectiveMonthlyPremium } from '../analytics-charts';

describe('effectiveMonthlyPremium', () => {
  test('explicit monthlyCost wins, even when totalCost is also set', () => {
    expect(
      effectiveMonthlyPremium({
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-06-30'),
        monthlyCost: 200,
        totalCost: 9999, // ignored — monthlyCost takes precedence
      })
    ).toBe(200);
  });

  test('monthlyCost of 0 is honoured (not treated as unset)', () => {
    expect(
      effectiveMonthlyPremium({
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-06-30'),
        monthlyCost: 0,
        totalCost: 1200,
      })
    ).toBe(0);
  });

  test('totalCost-only term amortizes across the inclusive month span (the bug #8 case)', () => {
    // Jan..Jun inclusive = 6 month keys → 1200 / 6 = 200 (was silently $0 before the fix).
    expect(
      effectiveMonthlyPremium({
        startDate: new Date('2024-01-15'),
        endDate: new Date('2024-06-20'),
        monthlyCost: null,
        totalCost: 1200,
      })
    ).toBe(200);
  });

  test('totalCost amortization is day-1 anchored — a day-31 start does not skip a month', () => {
    // Jan 31 .. Mar 1: monthKeysInRange anchors to day-1, so Jan/Feb/Mar = 3 keys (not 2).
    // A raw setMonth walk would overshoot Feb (Jan 31 + 1mo → Mar 2) and undercount.
    expect(
      effectiveMonthlyPremium({
        startDate: new Date('2024-01-31'),
        endDate: new Date('2024-03-01'),
        monthlyCost: null,
        totalCost: 300,
      })
    ).toBe(100); // 300 / 3 months
  });

  test('single-month term: totalCost maps to that one month', () => {
    expect(
      effectiveMonthlyPremium({
        startDate: new Date('2024-04-05'),
        endDate: new Date('2024-04-25'),
        monthlyCost: null,
        totalCost: 150,
      })
    ).toBe(150); // one month key → 150 / 1
  });

  test('returns 0 when neither cost is set', () => {
    expect(
      effectiveMonthlyPremium({
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-06-30'),
        monthlyCost: null,
        totalCost: null,
      })
    ).toBe(0);
  });

  test('totalCost with no resolvable span (null dates) returns 0 rather than dividing by zero', () => {
    expect(
      effectiveMonthlyPremium({
        startDate: null,
        endDate: null,
        monthlyCost: null,
        totalCost: 1200,
      })
    ).toBe(0);
    // Half-open span (one date missing) also has no resolvable range.
    expect(
      effectiveMonthlyPremium({
        startDate: new Date('2024-01-01'),
        endDate: null,
        monthlyCost: null,
        totalCost: 1200,
      })
    ).toBe(0);
  });
});
