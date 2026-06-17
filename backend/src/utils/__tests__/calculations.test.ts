/**
 * Unit tests for calculateMilesPerKwh and calculateAverageMilesPerKwh
 *
 * Validates: Requirements 4.8, 4.9, 4.10, 4.11
 */

import { describe, expect, test } from 'bun:test';
import type { Expense } from '../../db/schema';
import {
  averageConsecutiveMpg,
  calculateAverageMilesPerKwh,
  calculateMilesPerKwh,
  parseClampedInt,
  sortExpensesByDate,
} from '../calculations';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeChargeExpense(overrides: {
  mileage: number | null;
  volume: number | null;
  missedFillup?: boolean;
  index: number;
}): Expense {
  return {
    id: `exp-${overrides.index}`,
    vehicleId: 'vehicle-A',
    category: 'fuel',
    tags: [],
    date: new Date(2024, 0, 1 + overrides.index),
    expenseAmount: 15,
    mileage: overrides.mileage,
    volume: overrides.volume,
    fuelType: 'Level 2 (AC)',
    description: null,
    missedFillup: overrides.missedFillup ?? false,
    userId: 'test-user',
    groupId: null,
    groupTotal: null,
    splitMethod: null,
    sourceType: null,
    sourceId: null,
    clientId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

// ---------------------------------------------------------------------------
// calculateMilesPerKwh
// ---------------------------------------------------------------------------
describe('calculateMilesPerKwh', () => {
  test('returns miles / kwh for positive kwh', () => {
    expect(calculateMilesPerKwh(100, 25)).toBe(4);
  });

  test('returns 0 when kwh is 0', () => {
    expect(calculateMilesPerKwh(100, 0)).toBe(0);
  });

  test('returns 0 when kwh is negative', () => {
    expect(calculateMilesPerKwh(100, -5)).toBe(0);
  });

  test('result is never NaN', () => {
    const result = calculateMilesPerKwh(0, 0);
    expect(Number.isNaN(result)).toBe(false);
  });

  test('result is never Infinity', () => {
    const result = calculateMilesPerKwh(100, 0);
    expect(Number.isFinite(result)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// calculateAverageMilesPerKwh
// ---------------------------------------------------------------------------
describe('calculateAverageMilesPerKwh', () => {
  test('returns null for fewer than 2 expenses', () => {
    const single = [makeChargeExpense({ mileage: 1000, volume: 30, index: 0 })];
    expect(calculateAverageMilesPerKwh(single)).toBeNull();
    expect(calculateAverageMilesPerKwh([])).toBeNull();
  });

  test('returns null when fewer than 2 expenses have mileage', () => {
    const expenses = [
      makeChargeExpense({ mileage: 1000, volume: 30, index: 0 }),
      makeChargeExpense({ mileage: null, volume: 25, index: 1 }),
    ];
    expect(calculateAverageMilesPerKwh(expenses)).toBeNull();
  });

  test('calculates correct average for valid pair', () => {
    // 100 miles / 30 kWh = 3.333 mi/kWh
    const expenses = [
      makeChargeExpense({ mileage: 1000, volume: 30, index: 0 }),
      makeChargeExpense({ mileage: 1100, volume: 30, index: 1 }),
    ];
    const result = calculateAverageMilesPerKwh(expenses);
    expect(result).not.toBeNull();
    expect(result).toBeCloseTo(100 / 30, 5);
  });

  test('excludes pairs with missedFillup', () => {
    const expenses = [
      makeChargeExpense({ mileage: 1000, volume: 30, index: 0 }),
      makeChargeExpense({ mileage: 1100, volume: 30, missedFillup: true, index: 1 }),
      makeChargeExpense({ mileage: 1200, volume: 25, index: 2 }),
    ];
    // Pair (0,1) skipped because 1 is missedFillup
    // Pair (1,2) skipped because 1 is missedFillup
    // No valid pairs → null
    expect(calculateAverageMilesPerKwh(expenses)).toBeNull();
  });

  test('filters out unrealistic values > 10 mi/kWh', () => {
    // 500 miles / 10 kWh = 50 mi/kWh → filtered out
    const expenses = [
      makeChargeExpense({ mileage: 1000, volume: 10, index: 0 }),
      makeChargeExpense({ mileage: 1500, volume: 10, index: 1 }),
    ];
    expect(calculateAverageMilesPerKwh(expenses)).toBeNull();
  });

  test('returns null when all pairs produce unrealistic values', () => {
    const expenses = [
      makeChargeExpense({ mileage: 1000, volume: 5, index: 0 }),
      makeChargeExpense({ mileage: 2000, volume: 5, index: 1 }),
      makeChargeExpense({ mileage: 3000, volume: 5, index: 2 }),
    ];
    // 1000/5 = 200, 1000/5 = 200 → both > 10 → null
    expect(calculateAverageMilesPerKwh(expenses)).toBeNull();
  });

  test('averages multiple valid pairs', () => {
    const expenses = [
      makeChargeExpense({ mileage: 1000, volume: 30, index: 0 }),
      makeChargeExpense({ mileage: 1120, volume: 40, index: 1 }), // 120/40 = 3.0
      makeChargeExpense({ mileage: 1240, volume: 30, index: 2 }), // 120/30 = 4.0
    ];
    const result = calculateAverageMilesPerKwh(expenses);
    expect(result).not.toBeNull();
    expect(result).toBeCloseTo((3.0 + 4.0) / 2, 5);
  });

  test('sorts expenses by date before calculating', () => {
    // Provide out-of-order expenses
    const expenses = [
      makeChargeExpense({ mileage: 1100, volume: 30, index: 2 }),
      makeChargeExpense({ mileage: 1000, volume: 30, index: 0 }),
    ];
    const result = calculateAverageMilesPerKwh(expenses);
    expect(result).not.toBeNull();
    // After sorting: index 0 (mileage 1000) then index 2 (mileage 1100)
    // 100 miles / 30 kWh = 3.333
    expect(result).toBeCloseTo(100 / 30, 5);
  });
});

// ---------------------------------------------------------------------------
// averageConsecutiveMpg (C17 dedup) — the SHARED consecutive-fill-up MPG loop that calculateAverageMPG
// (calculations.ts) and calculateAverageMpg (vehicle-stats.ts) both delegate to. Before C17 the loop was
// hand-copied at both sites (C161 proved a copy once lost its guard); now it's ONE helper. It was only
// tested INDIRECTLY through its two callers (the C181/C229 "helper tested only in isolation" gap, same as
// monthsBetween/C6) — these pin its OWN cells directly so a future edit to the band / skip / guard can't
// drift undetected. The helper takes PRE-SORTED rows (callers own the sort) + the minimal {mileage,
// volume, missedFillup} shape. NOTE the (0,150) band is the #30-escalated divergence point — pinned EXACTLY
// here; do not "fix" it without the product call.
// ---------------------------------------------------------------------------
describe('averageConsecutiveMpg (C17 shared consecutive-pair MPG loop)', () => {
  test('averages consecutive pairs: miles-driven / current.volume', () => {
    // (1100−1000)/25 = 4 ; (1240−1100)/35 = 4 → mean 4
    expect(
      averageConsecutiveMpg([
        { mileage: 1000, volume: 20, missedFillup: false },
        { mileage: 1100, volume: 25, missedFillup: false },
        { mileage: 1240, volume: 35, missedFillup: false },
      ])
    ).toBeCloseTo((100 / 25 + 140 / 35) / 2, 5);
  });

  test('< 2 rows (and an empty list) → null (no pair to average)', () => {
    expect(averageConsecutiveMpg([])).toBeNull();
    expect(averageConsecutiveMpg([{ mileage: 1000, volume: 20 }])).toBeNull();
  });

  test('skips a pair touching a missedFillup row (current OR previous)', () => {
    // 3 rows, the middle one missedFillup → both pairs (0,1) and (1,2) skipped → null.
    expect(
      averageConsecutiveMpg([
        { mileage: 1000, volume: 20 },
        { mileage: 1100, volume: 25, missedFillup: true },
        { mileage: 1200, volume: 25 },
      ])
    ).toBeNull();
  });

  test('requires both odometer readings AND the current volume (else the pair is dropped)', () => {
    // previous mileage null → pair (0,1) dropped; current volume null → pair (1,2) dropped → null.
    expect(
      averageConsecutiveMpg([
        { mileage: null, volume: 20 },
        { mileage: 1100, volume: 25 },
        { mileage: 1200, volume: null },
      ])
    ).toBeNull();
  });

  test('drops unrealistic MPG outside (0, 150): negative miles AND >=150 both excluded', () => {
    // (900−1000)=−100 → mpg<0 dropped; (900+? ) build a >150 case: (4000−900)/20=155 → dropped → null.
    expect(
      averageConsecutiveMpg([
        { mileage: 1000, volume: 20 },
        { mileage: 900, volume: 20 }, // negative delta → mpg<0 → dropped
        { mileage: 4000, volume: 20 }, // 3100/20 = 155 ≥ 150 → dropped
      ])
    ).toBeNull();
  });

  test('the band is half-open at the top: 149.9 kept, exactly 150 dropped', () => {
    // NOTE the loop guard is `current.mileage && previous.mileage` (truthy) — a 0 odometer is falsy and
    // drops the pair, so anchor at a non-zero start. previous=10: (2998+10−10... ) use delta directly.
    // delta 2998 / vol 20 = 149.9 (in-band, < 150) → kept.
    const inBand = averageConsecutiveMpg([
      { mileage: 10, volume: 20 },
      { mileage: 2998 + 10, volume: 20 }, // delta 2998 → 149.9 → kept
    ]);
    expect(inBand).toBeCloseTo(149.9, 5);
    // delta exactly 3000 / 20 = 150 → NOT < 150 → dropped → null.
    const atBoundary = averageConsecutiveMpg([
      { mileage: 10, volume: 20 },
      { mileage: 3000 + 10, volume: 20 }, // delta 3000 → exactly 150 → dropped → null
    ]);
    expect(atBoundary).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// parseClampedInt (C211 — the insurance /expiring-soon days/limit dedup; the #70 guard)
// ---------------------------------------------------------------------------

describe('parseClampedInt', () => {
  test('a valid in-range value parses through unchanged', () => {
    expect(parseClampedInt('45', 30, 1, 366)).toBe(45);
  });

  test('undefined (missing param) → fallback', () => {
    expect(parseClampedInt(undefined, 30, 1, 366)).toBe(30);
  });

  test('a non-numeric value → fallback (the #70 guard: never NaN)', () => {
    expect(parseClampedInt('abc', 30, 1, 366)).toBe(30);
    expect(parseClampedInt('', 30, 1, 366)).toBe(30);
  });

  test('above max clamps to the ceiling', () => {
    expect(parseClampedInt('99999', 100, 1, 200)).toBe(200);
  });

  test('below min clamps to the floor', () => {
    expect(parseClampedInt('-5', 100, 1, 200)).toBe(1);
  });

  test('parseInt tolerates a trailing unit but not a leading non-digit', () => {
    // parseInt('45px') = 45 (then clamped); parseInt('px45') = NaN → fallback. Documents the
    // parse semantics so a future change to a stricter parser is a conscious one.
    expect(parseClampedInt('45px', 30, 1, 366)).toBe(45);
    expect(parseClampedInt('px45', 30, 1, 366)).toBe(30);
  });
});

// C421: sortExpensesByDate is the ONE source of truth for the chronological-order invariant the pairwise
// efficiency calcs require (calculateAverageMPG / calculateAverageMilesPerKwh / the /stats handler all
// pair consecutive rows; unsorted input silently mis-pairs — the #75/C222 class). Pins ascending order,
// no input mutation, and Date+string date handling.
describe('sortExpensesByDate', () => {
  test('sorts ASCENDING by date', () => {
    const rows = [
      { date: '2024-03-10', id: 'b' },
      { date: '2024-01-05', id: 'a' },
      { date: '2024-06-20', id: 'c' },
    ];
    expect(sortExpensesByDate(rows).map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });

  test('does NOT mutate the input array (sorts a copy)', () => {
    const rows = [
      { date: '2024-03-10', id: 'b' },
      { date: '2024-01-05', id: 'a' },
    ];
    const sorted = sortExpensesByDate(rows);
    expect(rows.map((r) => r.id)).toEqual(['b', 'a']); // original order untouched
    expect(sorted.map((r) => r.id)).toEqual(['a', 'b']);
    expect(sorted).not.toBe(rows);
  });

  test('handles a mix of Date and string dates', () => {
    const rows = [
      { date: new Date('2024-05-01'), id: 'mid' },
      { date: '2024-02-01', id: 'early' },
      { date: new Date('2024-09-01'), id: 'late' },
    ];
    expect(sortExpensesByDate(rows).map((r) => r.id)).toEqual(['early', 'mid', 'late']);
  });

  test('empty + single-element inputs are returned as-is (sorted copy)', () => {
    expect(sortExpensesByDate([])).toEqual([]);
    expect(sortExpensesByDate([{ date: '2024-01-01', id: 'x' }]).map((r) => r.id)).toEqual(['x']);
  });
});
