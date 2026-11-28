import { describe, expect, test } from 'bun:test';
import { effectiveTermCost } from '../../api/insurance/hooks';
import { effectiveMonthlyPremium } from '../analytics-charts';

describe('effectiveMonthlyPremium', () => {
  test('a total cost above 0 wins over the monthly cost, like the premium expense', () => {
    expect(
      effectiveMonthlyPremium({
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-06-30'),
        monthlyCost: 150,
        totalCost: 1200,
      })
    ).toBe(200);
  });

  test('a monthly cost of 0 falls back to the total cost', () => {
    expect(
      effectiveMonthlyPremium({
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-06-30'),
        monthlyCost: 0,
        totalCost: 1200,
      })
    ).toBe(200);
  });

  test('a total cost of 0 falls back to the monthly cost', () => {
    expect(
      effectiveMonthlyPremium({
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-06-30'),
        monthlyCost: 150,
        totalCost: 0,
      })
    ).toBe(150);
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

  test('times the billed months, it always equals the premium expense', () => {
    const startDate = new Date('2024-01-01');
    const endDate = new Date('2024-12-31');
    for (const [monthlyCost, totalCost] of [
      [150, 1200],
      [0, 1200],
      [150, 0],
      [null, 1200],
      [150, null],
      [0, 0],
    ] as const) {
      const monthly = effectiveMonthlyPremium({ startDate, endDate, monthlyCost, totalCost });
      const expense = effectiveTermCost({
        totalCost: totalCost ?? 0,
        monthlyCost,
        startDate,
        endDate,
      });
      expect(monthly * 12, `${monthlyCost} / ${totalCost}`).toBeCloseTo(expense, 6);
    }
  });
});
