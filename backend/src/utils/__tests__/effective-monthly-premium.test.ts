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
    expect(
      effectiveMonthlyPremium({
        startDate: new Date('2024-01-15'),
        endDate: new Date('2024-06-20'),
        monthlyCost: null,
        totalCost: 1200,
      })
    ).toBe(200);
  });

  test('a day-31 start counts the billing periods it starts, clamped to short months', () => {
    expect(
      effectiveMonthlyPremium({
        startDate: new Date('2024-01-31'),
        endDate: new Date('2024-03-01'),
        monthlyCost: null,
        totalCost: 300,
      })
    ).toBe(150);
  });

  test('a six-month term ending on its anniversary day amortizes over six months, not seven', () => {
    expect(
      effectiveMonthlyPremium({
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-07-01'),
        monthlyCost: null,
        totalCost: 1200,
      })
    ).toBe(200);
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
