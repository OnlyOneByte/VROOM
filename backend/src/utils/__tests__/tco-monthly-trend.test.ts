import { describe, expect, test } from 'bun:test';
import { buildTCOMonthlyTrend } from '../analytics-charts';

describe('buildTCOMonthlyTrend — (category, sourceType) bucketing', () => {
  test('routes each row to its category bucket; same-month rows co-accumulate', () => {
    const jan = new Date(2024, 0, 15);
    const trend = buildTCOMonthlyTrend([
      { category: 'financial', sourceType: 'financing', expenseAmount: 300, date: jan },
      { category: 'financial', sourceType: 'insurance_term', expenseAmount: 120, date: jan },
      { category: 'fuel', sourceType: null, expenseAmount: 45, date: jan },
      { category: 'maintenance', sourceType: null, expenseAmount: 80, date: jan },
    ]);

    expect(trend).toHaveLength(1);
    expect(trend[0]).toEqual({
      month: '2024-01',
      financing: 300,
      insurance: 120,
      fuel: 45,
      maintenance: 80,
    });
  });

  test('uncategorized rows contribute to no bucket', () => {
    const jan = new Date(2024, 0, 10);
    const trend = buildTCOMonthlyTrend([
      { category: 'financial', sourceType: 'reminder', expenseAmount: 999, date: jan },
      { category: 'financial', sourceType: null, expenseAmount: 50, date: jan },
      { category: 'regulatory', sourceType: null, expenseAmount: 40, date: jan },
      { category: 'enhancement', sourceType: null, expenseAmount: 200, date: jan },
      { category: 'misc', sourceType: null, expenseAmount: 30, date: jan },
    ]);

    expect(trend).toEqual([
      { month: '2024-01', financing: 0, insurance: 0, fuel: 0, maintenance: 0 },
    ]);
  });

  test('financial rows are bucketed by sourceType', () => {
    const jan = new Date(2024, 0, 1);
    const trend = buildTCOMonthlyTrend([
      { category: 'financial', sourceType: 'financing', expenseAmount: 100, date: jan },
      { category: 'financial', sourceType: 'insurance_term', expenseAmount: 60, date: jan },
      { category: 'financial', sourceType: 'reminder', expenseAmount: 500, date: jan },
    ]);
    const jan2024 = trend.find((t) => t.month === '2024-01');
    expect(jan2024?.financing).toBe(100);
    expect(jan2024?.insurance).toBe(60);
    expect(
      (jan2024?.financing ?? 0) + (jan2024?.insurance ?? 0),
      'the reminder row is not double-counted'
    ).toBe(160);
  });

  test('groups across months and SORTS ascending by month key', () => {
    const trend = buildTCOMonthlyTrend([
      { category: 'fuel', sourceType: null, expenseAmount: 30, date: new Date(2024, 2, 5) },
      { category: 'fuel', sourceType: null, expenseAmount: 40, date: new Date(2024, 0, 5) },
      { category: 'fuel', sourceType: null, expenseAmount: 50, date: new Date(2023, 11, 5) },
      { category: 'fuel', sourceType: null, expenseAmount: 10, date: new Date(2024, 0, 20) },
    ]);

    expect(trend.map((t) => t.month)).toEqual(['2023-12', '2024-01', '2024-03']);
    expect(trend.find((t) => t.month === '2024-01')?.fuel).toBe(50);
  });

  test('a dateless row is dropped (no crash, no phantom month key)', () => {
    const trend = buildTCOMonthlyTrend([
      { category: 'fuel', sourceType: null, expenseAmount: 25, date: new Date(2024, 0, 5) },
      { category: 'fuel', sourceType: null, expenseAmount: 999, date: null },
    ]);
    expect(trend).toHaveLength(1);
    expect(trend[0]?.fuel).toBe(25);
  });

  test('empty input → empty series (no crash)', () => {
    expect(buildTCOMonthlyTrend([])).toEqual([]);
  });
});
