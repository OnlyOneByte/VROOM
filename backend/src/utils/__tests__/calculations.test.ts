import { describe, expect, test } from 'bun:test';
import type { Expense } from '../../db/schema';
import {
  averageConsecutiveMpg,
  calculateAverageMilesPerKwh,
  parseClampedInt,
  sortExpensesByDate,
} from '../calculations';

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
    location: null,
    missedFillup: overrides.missedFillup ?? false,
    userId: 'test-user',
    createdBy: null,
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
    expect(calculateAverageMilesPerKwh(expenses)).toBeNull();
  });

  test('filters out unrealistic values > 10 mi/kWh', () => {
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
    expect(calculateAverageMilesPerKwh(expenses)).toBeNull();
  });

  test('averages multiple valid pairs', () => {
    const expenses = [
      makeChargeExpense({ mileage: 1000, volume: 30, index: 0 }),
      makeChargeExpense({ mileage: 1120, volume: 40, index: 1 }),
      makeChargeExpense({ mileage: 1240, volume: 30, index: 2 }),
    ];
    const result = calculateAverageMilesPerKwh(expenses);
    expect(result).not.toBeNull();
    expect(result).toBeCloseTo((3.0 + 4.0) / 2, 5);
  });

  test('sorts expenses by date before calculating', () => {
    const expenses = [
      makeChargeExpense({ mileage: 1100, volume: 30, index: 2 }),
      makeChargeExpense({ mileage: 1000, volume: 30, index: 0 }),
    ];
    const result = calculateAverageMilesPerKwh(expenses);
    expect(result).not.toBeNull();
    expect(result).toBeCloseTo(100 / 30, 5);
  });
});

describe('averageConsecutiveMpg', () => {
  test('averages consecutive pairs: miles-driven / current.volume', () => {
    expect(
      averageConsecutiveMpg([
        { mileage: 1000, volume: 20, missedFillup: false },
        { mileage: 1500, volume: 20, missedFillup: false },
        { mileage: 2100, volume: 20, missedFillup: false },
      ])
    ).toBeCloseTo((500 / 20 + 600 / 20) / 2, 5);
  });

  test('fewer than 2 rows (and an empty list) gives null', () => {
    expect(averageConsecutiveMpg([])).toBeNull();
    expect(averageConsecutiveMpg([{ mileage: 1000, volume: 20 }])).toBeNull();
  });

  test('skips a pair touching a missedFillup row (current or previous)', () => {
    expect(
      averageConsecutiveMpg([
        { mileage: 1000, volume: 20 },
        { mileage: 1100, volume: 25, missedFillup: true },
        { mileage: 1200, volume: 25 },
      ])
    ).toBeNull();
  });

  test('requires both odometer readings and the current volume', () => {
    expect(
      averageConsecutiveMpg([
        { mileage: null, volume: 20 },
        { mileage: 1100, volume: 25 },
        { mileage: 1200, volume: null },
      ])
    ).toBeNull();
  });

  test('drops unrealistic MPG outside [5,100]', () => {
    expect(
      averageConsecutiveMpg([
        { mileage: 1000, volume: 20 },
        { mileage: 1080, volume: 20 },
        { mileage: 3200, volume: 20 },
      ])
    ).toBeNull();
  });

  test('the [5,100] band is INCLUSIVE at both edges (exactly 5 and exactly 100 are kept)', () => {
    expect(
      averageConsecutiveMpg([
        { mileage: 10, volume: 20 },
        { mileage: 110, volume: 20 },
      ])
    ).toBeCloseTo(5, 5);
    expect(
      averageConsecutiveMpg([
        { mileage: 10, volume: 20 },
        { mileage: 2010, volume: 20 },
      ])
    ).toBeCloseTo(100, 5);
    expect(
      averageConsecutiveMpg([
        { mileage: 10, volume: 20 },
        { mileage: 109, volume: 20 },
      ])
    ).toBeNull();
  });
});

describe('parseClampedInt', () => {
  test('a valid in-range value parses through unchanged', () => {
    expect(parseClampedInt('45', 30, 1, 366)).toBe(45);
  });

  test('undefined (missing param) gives the fallback', () => {
    expect(parseClampedInt(undefined, 30, 1, 366)).toBe(30);
  });

  test('a non-numeric value gives the fallback, never NaN', () => {
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
    expect(parseClampedInt('45px', 30, 1, 366)).toBe(45);
    expect(parseClampedInt('px45', 30, 1, 366)).toBe(30);
  });
});

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
    expect(rows.map((r) => r.id)).toEqual(['b', 'a']);
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

  test('empty and single-element inputs are returned as a sorted copy', () => {
    expect(sortExpensesByDate([])).toEqual([]);
    expect(sortExpensesByDate([{ date: '2024-01-01', id: 'x' }]).map((r) => r.id)).toEqual(['x']);
  });
});
