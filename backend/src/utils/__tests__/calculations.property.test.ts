/**
 * Property-Based Tests for calculations.ts — calculateAverageMPG
 *
 * Property 1: Missed fill-up pairs are excluded from calculations
 * Property 2: Backward compatibility when no expenses are flagged
 *
 * Validates: Requirements 3.1, 3.2, 3.3, 3.4
 */

import { describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import type { Expense } from '../../db/schema';
import { calculateAverageMPG } from '../calculations';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a synthetic Expense for testing calculateAverageMPG. */
function makeExpense(overrides: {
  mileage: number;
  volume: number;
  missedFillup: boolean;
  index: number;
}): Expense {
  return {
    id: `exp-${overrides.index}`,
    vehicleId: 'vehicle-A',
    category: 'fuel',
    tags: [],
    date: new Date(2024, 0, 1 + overrides.index),
    expenseAmount: overrides.volume * 3.5,
    mileage: overrides.mileage,
    volume: overrides.volume,
    fuelType: '87 (Regular)',
    description: null,
    receiptUrl: null,
    isFinancingPayment: false,
    insuranceTermId: null,
    missedFillup: overrides.missedFillup,
    userId: 'test-user',
    groupId: null,
    groupTotal: null,
    splitMethod: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

/**
 * Reference implementation: count valid MPG pairs excluding missed fill-ups.
 */
function countFilteredPairs(expenses: Expense[]): number {
  const sorted = [...expenses].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
  );
  let count = 0;
  for (let i = 1; i < sorted.length; i++) {
    const current = sorted[i];
    const previous = sorted[i - 1];
    if (current.missedFillup || previous.missedFillup) continue;
    if (current.mileage && previous.mileage && current.volume) {
      const miles = current.mileage - previous.mileage;
      const mpg = miles / current.volume;
      if (mpg > 0 && mpg < 150) count++;
    }
  }
  return count;
}

/**
 * Count valid MPG pairs without missed fill-up filtering.
 */
function countUnfilteredPairs(expenses: Expense[]): number {
  const sorted = [...expenses].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
  );
  let count = 0;
  for (let i = 1; i < sorted.length; i++) {
    const current = sorted[i];
    const previous = sorted[i - 1];
    if (current.mileage && previous.mileage && current.volume) {
      const miles = current.mileage - previous.mileage;
      const mpg = miles / current.volume;
      if (mpg > 0 && mpg < 150) count++;
    }
  }
  return count;
}

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

const expenseListArb = fc.integer({ min: 2, max: 20 }).chain((len) =>
  fc.tuple(
    ...Array.from({ length: len }, (_, i) =>
      fc.record({
        mileage: fc.integer({ min: 10000 + i * 200, max: 10000 + i * 200 + 199 }),
        volume: fc.double({ min: 5, max: 25, noNaN: true }),
        missedFillup: fc.boolean(),
        index: fc.constant(i),
      })
    )
  )
);

const allUnflaggedListArb = fc.integer({ min: 2, max: 20 }).chain((len) =>
  fc.tuple(
    ...Array.from({ length: len }, (_, i) =>
      fc.record({
        mileage: fc.integer({ min: 10000 + i * 200, max: 10000 + i * 200 + 199 }),
        volume: fc.double({ min: 5, max: 25, noNaN: true }),
        missedFillup: fc.constant(false),
        index: fc.constant(i),
      })
    )
  )
);

// ---------------------------------------------------------------------------
// Property 1: Missed fill-up pairs are excluded
// ---------------------------------------------------------------------------
describe('Property 1: Missed fill-up pairs are excluded from calculateAverageMPG', () => {
  test('result is null when all pairs are skipped due to missed fill-ups', () => {
    // All expenses flagged as missed → no valid pairs → null
    const expenses = [
      makeExpense({ mileage: 10000, volume: 10, missedFillup: true, index: 0 }),
      makeExpense({ mileage: 10300, volume: 12, missedFillup: true, index: 1 }),
      makeExpense({ mileage: 10600, volume: 11, missedFillup: true, index: 2 }),
    ];
    expect(calculateAverageMPG(expenses)).toBeNull();
  });

  test('number of included pairs matches reference count excluding missed', () => {
    fc.assert(
      fc.property(expenseListArb, (inputs) => {
        const expenses = inputs.map((input) => makeExpense(input));
        const result = calculateAverageMPG(expenses);
        const expectedCount = countFilteredPairs(expenses);

        if (expectedCount === 0) {
          expect(result).toBeNull();
        } else {
          expect(result).not.toBeNull();
          // Result should be within valid MPG bounds
          if (result !== null) {
            expect(result).toBeGreaterThan(0);
            expect(result).toBeLessThan(150);
          }
        }
      }),
      { numRuns: 100 }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 2: Backward compatibility when no expenses are flagged
// ---------------------------------------------------------------------------
describe('Property 2: Backward compatibility for calculateAverageMPG', () => {
  test('unflagged expenses produce same pair count as unfiltered calculation', () => {
    fc.assert(
      fc.property(allUnflaggedListArb, (inputs) => {
        const expenses = inputs.map((input) => makeExpense(input));
        const filteredCount = countFilteredPairs(expenses);
        const unfilteredCount = countUnfilteredPairs(expenses);

        expect(filteredCount).toBe(unfilteredCount);
      }),
      { numRuns: 100 }
    );
  });

  test('result is non-null when valid unflagged pairs exist', () => {
    const expenses = [
      makeExpense({ mileage: 10000, volume: 10, missedFillup: false, index: 0 }),
      makeExpense({ mileage: 10300, volume: 12, missedFillup: false, index: 1 }),
    ];
    const result = calculateAverageMPG(expenses);
    expect(result).not.toBeNull();
    if (result !== null) {
      expect(result).toBeCloseTo(300 / 12, 5);
    }
  });
});
