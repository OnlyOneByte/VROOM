/**
 * Unit tests for calculateMilesPerKwh and calculateAverageMilesPerKwh
 *
 * Validates: Requirements 4.8, 4.9, 4.10, 4.11
 */

import { describe, expect, test } from 'bun:test';
import type { Expense } from '../../db/schema';
import { calculateAverageMilesPerKwh, calculateMilesPerKwh } from '../calculations';

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
    receiptUrl: null,
    isFinancingPayment: false,
    insuranceTermId: null,
    missedFillup: overrides.missedFillup ?? false,
    userId: 'test-user',
    groupId: null,
    groupTotal: null,
    splitMethod: null,
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
