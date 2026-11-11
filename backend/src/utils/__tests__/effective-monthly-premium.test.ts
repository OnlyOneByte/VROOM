import { describe, expect, test } from 'bun:test';
import { effectiveMonthlyPremium } from '../analytics-charts';

describe('effectiveMonthlyPremium', () => {
  test('explicit monthlyCost wins, even when totalCost is also set', () => {
    expect(
      effectiveMonthlyPremium({
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-06-30'),
        monthlyCost: 200,
        totalCost: 9999,
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

  test('totalCost-only term amortizes across the inclusive month span', () => {
    // Jan through Jun is 6 month keys, so 1200 / 6 = 200.
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
    // Jan 31 .. Mar 1 spans Jan, Feb, and Mar. A raw setMonth walk would skip February.
    expect(
      effectiveMonthlyPremium({
        startDate: new Date('2024-01-31'),
        endDate: new Date('2024-03-01'),
        monthlyCost: null,
        totalCost: 300,
      })
    ).toBe(100);
  });

  test('single-month term: totalCost maps to that one month', () => {
    expect(
      effectiveMonthlyPremium({
        startDate: new Date('2024-04-05'),
        endDate: new Date('2024-04-25'),
        monthlyCost: null,
        totalCost: 150,
      })
    ).toBe(150);
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

  test('totalCost with no resolvable span returns 0 rather than dividing by zero', () => {
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
