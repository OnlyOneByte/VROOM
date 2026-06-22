/**
 * Direct certification of buildTCOMonthlyTrend (C53 deep-review). This is the per-month total-cost-of-
 * ownership SERIES the TCO chart renders, and it was driven ONLY transitively through getTCO — no test
 * asserted its bucketing (the C6/C18/C46 "helper output never pinned" gap, on a money-facing series).
 *
 * The contract (certified firsthand against source, analytics-charts.ts):
 *   - Buckets each row by (category, sourceType): financial+financing → financing; financial+insurance_term
 *     → insurance; fuel → fuel; maintenance → maintenance. This MIRRORS categorizeTCOExpenses (the TCO
 *     TOTAL bucketing, certified C33), but in the TIME dimension.
 *   - An UNCATEGORIZED row contributes to NO bucket — a financial+reminder (recurring, C27) or financial+null
 *     (manual) row, or a regulatory/enhancement/misc row, is silently EXCLUDED from the trend (the deliberate
 *     "the trend shows only the 4 named categories" contract; categorizeTCOExpenses routes those to
 *     otherCosts, which the trend simply doesn't surface). A mis-bucket here would inflate a displayed money
 *     series (NORTH_STAR #1).
 *   - Same-month rows of different categories co-accumulate into one month entry; the series is sorted
 *     ascending by YYYY-MM month key; a dateless row is dropped (no crash, no phantom key).
 *
 * toMonthKey uses LOCAL getFullYear/getMonth, so these construct dates via new Date(y, mIdx, d) (local) for
 * timezone-stable keys.
 */

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

  test('an uncategorized row contributes to NO bucket (the 4-named-categories contract)', () => {
    const jan = new Date(2024, 0, 10);
    const trend = buildTCOMonthlyTrend([
      // A recurring-expense materialized financial row (sourceType 'reminder', C27) — NOT financing/insurance.
      { category: 'financial', sourceType: 'reminder', expenseAmount: 999, date: jan },
      // A manual financial row (null sourceType).
      { category: 'financial', sourceType: null, expenseAmount: 50, date: jan },
      // Categories with no TCO-trend bucket at all.
      { category: 'regulatory', sourceType: null, expenseAmount: 40, date: jan },
      { category: 'enhancement', sourceType: null, expenseAmount: 200, date: jan },
      { category: 'misc', sourceType: null, expenseAmount: 30, date: jan },
    ]);

    // The month exists only if at least one row was seen; all four buckets stay 0 (nothing inflated).
    expect(trend).toEqual([
      { month: '2024-01', financing: 0, insurance: 0, fuel: 0, maintenance: 0 },
    ]);
  });

  test('a financial row is bucketed by sourceType, NOT lumped — financing vs insurance vs other', () => {
    const jan = new Date(2024, 0, 1);
    const trend = buildTCOMonthlyTrend([
      { category: 'financial', sourceType: 'financing', expenseAmount: 100, date: jan },
      { category: 'financial', sourceType: 'insurance_term', expenseAmount: 60, date: jan },
      { category: 'financial', sourceType: 'reminder', expenseAmount: 500, date: jan },
    ]);
    // financing 100 + insurance 60; the reminder financial row is excluded (not folded into either).
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
      { category: 'fuel', sourceType: null, expenseAmount: 30, date: new Date(2024, 2, 5) }, // Mar
      { category: 'fuel', sourceType: null, expenseAmount: 40, date: new Date(2024, 0, 5) }, // Jan
      { category: 'fuel', sourceType: null, expenseAmount: 50, date: new Date(2023, 11, 5) }, // 2023-12
      { category: 'fuel', sourceType: null, expenseAmount: 10, date: new Date(2024, 0, 20) }, // Jan again
    ]);

    expect(trend.map((t) => t.month)).toEqual(['2023-12', '2024-01', '2024-03']);
    // Jan's two fuel rows accumulate (40 + 10).
    expect(trend.find((t) => t.month === '2024-01')?.fuel).toBe(50);
  });

  test('a dateless row is dropped (no crash, no phantom month key)', () => {
    const trend = buildTCOMonthlyTrend([
      { category: 'fuel', sourceType: null, expenseAmount: 25, date: new Date(2024, 0, 5) },
      { category: 'fuel', sourceType: null, expenseAmount: 999, date: null },
    ]);
    expect(trend).toHaveLength(1);
    expect(trend[0]?.fuel).toBe(25); // the dateless row never landed
  });

  test('empty input → empty series (no crash)', () => {
    expect(buildTCOMonthlyTrend([])).toEqual([]);
  });
});
