/**
 * Characterization tests for the dashboard EXPENSE-SUMMARY builder family in analytics-charts.ts
 * (C119 deep-review). These four GeneralExpenseRow[] -> chart-data builders had ZERO test
 * references — the exact never-pinned-analytics-builder class the loop's defect vein has lived in
 * (C7 pooled-distance, C11 oldest-slice, C14 month-skip, C53 TCO trend, C67 the six date builders).
 * The C119 audit read each against source and found them CORRECT; this locks that conclusion so a
 * future edit can't silently regress it (NORTH_STAR #5). The companion C67 file
 * (analytics-charts-unpinned.test.ts) certified the fuel/date builders; this is the expense-summary
 * sibling set that audit did not reach:
 *
 *   - buildExpenseByCategory       — the pie-chart contract: percentages SUM to 100, total===0 -> [],
 *                                     unknown category folds to 'misc'.
 *   - buildVehicleExpenseBreakdown — the same category fold WITHOUT percentages (no total guard).
 *   - buildMonthlyExpenseTrends    — localeCompare-then-slice(-24) keeps the NEWEST 24 months (the
 *                                     C11 oldest-slice direction class); same-month co-accumulate;
 *                                     dateless rows dropped.
 *   - findBiggestExpense           — strict-greater max-by-amount (first-wins on ties), []->null,
 *                                     null-description fallback, ISO date.
 *
 * Pure module → no DB, no server.
 */

import { describe, expect, test } from 'bun:test';
import {
  buildExpenseByCategory,
  buildMonthlyExpenseTrends,
  buildVehicleExpenseBreakdown,
  findBiggestExpense,
  type GeneralExpenseRow,
} from '../analytics-charts';

// Local-time date for a given Y/M/D so the bucketing assertions are timezone-independent
// (the functions bucket on local getMonth/getFullYear via toMonthKey — matches the C6/C11/C67
// discipline of constructing local-time dates, never UTC ISO strings, in analytics tests).
function d(year: number, month1to12: number, day: number): Date {
  return new Date(year, month1to12 - 1, day);
}

function genRow(over: Partial<GeneralExpenseRow> = {}): GeneralExpenseRow {
  return {
    id: 'e1',
    vehicleId: 'v1',
    category: 'fuel',
    description: null,
    expenseAmount: 40,
    date: d(2024, 1, 15),
    mileage: null,
    volume: null,
    missedFillup: false,
    ...over,
  };
}

describe('buildExpenseByCategory', () => {
  test('empty input returns [] (no divide-by-zero on total)', () => {
    expect(buildExpenseByCategory([])).toEqual([]);
  });

  test('all-zero amounts return [] (the total===0 guard, not NaN percentages)', () => {
    const out = buildExpenseByCategory([
      genRow({ category: 'fuel', expenseAmount: 0 }),
      genRow({ category: 'maintenance', expenseAmount: 0 }),
    ]);
    expect(out).toEqual([]);
  });

  test('percentages sum to 100 across categories (the pie-chart contract)', () => {
    const out = buildExpenseByCategory([
      genRow({ category: 'fuel', expenseAmount: 30 }),
      genRow({ category: 'maintenance', expenseAmount: 60 }),
      genRow({ category: 'misc', expenseAmount: 10 }),
    ]);
    const totalPct = out.reduce((s, e) => s + e.percentage, 0);
    expect(totalPct).toBeCloseTo(100, 10);
    const fuel = out.find((e) => e.category === 'fuel');
    expect(fuel?.amount).toBe(30);
    expect(fuel?.percentage).toBeCloseTo(30, 10);
  });

  test('same-category rows co-accumulate into one entry', () => {
    const out = buildExpenseByCategory([
      genRow({ category: 'fuel', expenseAmount: 40 }),
      genRow({ category: 'fuel', expenseAmount: 60 }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]?.amount).toBe(100);
    expect(out[0]?.percentage).toBeCloseTo(100, 10);
  });

  test('an unknown category folds into misc (the VALID_CATEGORIES guard)', () => {
    const out = buildExpenseByCategory([
      genRow({ category: 'definitely-not-a-real-category', expenseAmount: 25 }),
      genRow({ category: 'misc', expenseAmount: 75 }),
    ]);
    expect(out).toHaveLength(1);
    const misc = out.find((e) => e.category === 'misc');
    expect(misc?.amount).toBe(100);
    // the bogus category never leaks through as its own slice
    expect(out.some((e) => e.category === 'definitely-not-a-real-category')).toBe(false);
  });
});

describe('buildVehicleExpenseBreakdown', () => {
  test('empty input returns []', () => {
    expect(buildVehicleExpenseBreakdown([])).toEqual([]);
  });

  test('buckets by category and sums amounts (no percentage field)', () => {
    const out = buildVehicleExpenseBreakdown([
      genRow({ category: 'fuel', expenseAmount: 40 }),
      genRow({ category: 'fuel', expenseAmount: 10 }),
      genRow({ category: 'maintenance', expenseAmount: 200 }),
    ]);
    const fuel = out.find((e) => e.category === 'fuel');
    const maint = out.find((e) => e.category === 'maintenance');
    expect(fuel?.amount).toBe(50);
    expect(maint?.amount).toBe(200);
    // breakdown is raw amounts only — no percentage key (distinct from buildExpenseByCategory)
    expect(out.every((e) => !('percentage' in e))).toBe(true);
  });

  test('unknown category folds into misc here too', () => {
    const out = buildVehicleExpenseBreakdown([
      genRow({ category: 'bogus', expenseAmount: 5 }),
      genRow({ category: 'misc', expenseAmount: 15 }),
    ]);
    expect(out).toHaveLength(1);
    expect(out.find((e) => e.category === 'misc')?.amount).toBe(20);
  });
});

describe('buildMonthlyExpenseTrends', () => {
  test('empty input returns []', () => {
    expect(buildMonthlyExpenseTrends([])).toEqual([]);
  });

  test('same-month rows co-accumulate; output is ascending by month key', () => {
    const out = buildMonthlyExpenseTrends([
      genRow({ date: d(2024, 3, 5), expenseAmount: 30 }),
      genRow({ date: d(2024, 3, 25), expenseAmount: 70 }),
      genRow({ date: d(2024, 1, 10), expenseAmount: 10 }),
    ]);
    expect(out.map((e) => e.month)).toEqual(['2024-01', '2024-03']);
    expect(out.find((e) => e.month === '2024-03')?.amount).toBe(100);
  });

  test('rows with a null date are dropped (no NaN month key)', () => {
    const out = buildMonthlyExpenseTrends([
      genRow({ date: null, expenseAmount: 999 }),
      genRow({ date: d(2024, 2, 1), expenseAmount: 50 }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({ month: '2024-02', amount: 50 });
  });

  test('keeps the NEWEST 24 months, not the oldest (the C11 slice-direction class)', () => {
    // 30 distinct months Jan-2022 .. Jun-2024, $1 each. slice(-24) must drop the OLDEST 6.
    const rows: GeneralExpenseRow[] = [];
    for (let i = 0; i < 30; i++) {
      const year = 2022 + Math.floor(i / 12);
      const month = (i % 12) + 1;
      rows.push(genRow({ id: `e${i}`, date: d(year, month, 15), expenseAmount: 1 }));
    }
    const out = buildMonthlyExpenseTrends(rows);
    expect(out).toHaveLength(24);
    // newest retained is 2024-06 (i=29); oldest retained is 2022-07 (dropped 2022-01..2022-06).
    expect(out[out.length - 1]?.month).toBe('2024-06');
    expect(out[0]?.month).toBe('2022-07');
    // the oldest 6 months are GONE — a .slice(0,24) refactor would invert this (C11 regression).
    expect(out.some((e) => e.month === '2022-01')).toBe(false);
  });
});

describe('findBiggestExpense', () => {
  test('empty input returns null', () => {
    expect(findBiggestExpense([])).toBeNull();
  });

  test('returns the max-by-amount row with its description and ISO date', () => {
    const out = findBiggestExpense([
      genRow({ expenseAmount: 40, description: 'gas', date: d(2024, 1, 1) }),
      genRow({ expenseAmount: 500, description: 'new tires', date: d(2024, 2, 2) }),
      genRow({ expenseAmount: 120, description: 'oil', date: d(2024, 3, 3) }),
    ]);
    expect(out?.amount).toBe(500);
    expect(out?.description).toBe('new tires');
    // date is emitted as an ISO string
    expect(out?.date).toBe(d(2024, 2, 2).toISOString());
  });

  test('a null description falls back to "No description"', () => {
    const out = findBiggestExpense([genRow({ expenseAmount: 10, description: null })]);
    expect(out?.description).toBe('No description');
  });

  test('first row wins on an exact-amount tie (strict-greater comparison)', () => {
    const out = findBiggestExpense([
      genRow({ expenseAmount: 100, description: 'first' }),
      genRow({ expenseAmount: 100, description: 'second' }),
    ]);
    expect(out?.description).toBe('first');
  });
});
