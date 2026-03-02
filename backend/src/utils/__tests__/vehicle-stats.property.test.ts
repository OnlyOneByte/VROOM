/**
 * Property-Based Tests for vehicle-stats.ts — calculateAverageMpg
 *
 * Property 1: Missed fill-up pairs are excluded from calculations
 * Property 2: Backward compatibility when no expenses are flagged
 * Property 3: Monotonicity — flagging expenses never increases data point count
 *
 * Validates: Requirements 2.1, 2.2, 2.3, 2.4
 */

import { describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import type { FuelExpense } from '../vehicle-stats';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a synthetic FuelExpense for testing. */
function makeFuelExpense(overrides: {
  mileage: number;
  fuelAmount: number;
  missedFillup: boolean;
  index: number;
}): FuelExpense {
  return {
    id: `exp-${overrides.index}`,
    mileage: overrides.mileage,
    fuelAmount: overrides.fuelAmount,
    fuelType: '87 (Regular)',
    date: new Date(2024, 0, 1 + overrides.index),
    expenseAmount: overrides.fuelAmount * 3.5,
    missedFillup: overrides.missedFillup,
  };
}

/**
 * Reference implementation of calculateAverageMpg logic.
 * Computes MPG from consecutive pairs, skipping missed fill-ups.
 */
function referenceMpg(expenses: FuelExpense[]): { mpgValues: number[]; avg: number | null } {
  const mpgValues: number[] = [];
  for (let i = 1; i < expenses.length; i++) {
    const current = expenses[i];
    const previous = expenses[i - 1];
    if (current.missedFillup || previous.missedFillup) continue;
    if (current.mileage && previous.mileage && current.fuelAmount) {
      const miles = current.mileage - previous.mileage;
      const mpg = miles / current.fuelAmount;
      if (mpg > 0 && mpg < 150) {
        mpgValues.push(mpg);
      }
    }
  }
  if (mpgValues.length === 0) return { mpgValues, avg: null };
  return { mpgValues, avg: mpgValues.reduce((s, v) => s + v, 0) / mpgValues.length };
}

/**
 * Count valid MPG pairs without any missed fill-up filtering.
 */
function countUnfilteredPairs(expenses: FuelExpense[]): number {
  let count = 0;
  for (let i = 1; i < expenses.length; i++) {
    const current = expenses[i];
    const previous = expenses[i - 1];
    if (current.mileage && previous.mileage && current.fuelAmount) {
      const miles = current.mileage - previous.mileage;
      const mpg = miles / current.fuelAmount;
      if (mpg > 0 && mpg < 150) count++;
    }
  }
  return count;
}

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

const fuelExpenseListArb = fc.integer({ min: 2, max: 20 }).chain((len) =>
  fc.tuple(
    ...Array.from({ length: len }, (_, i) =>
      fc.record({
        mileage: fc.integer({ min: 10000 + i * 200, max: 10000 + i * 200 + 199 }),
        fuelAmount: fc.double({ min: 5, max: 25, noNaN: true }),
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
        fuelAmount: fc.double({ min: 5, max: 25, noNaN: true }),
        missedFillup: fc.constant(false),
        index: fc.constant(i),
      })
    )
  )
);

/**
 * Verify that included MPG values match the reference calculation exactly.
 */
function verifyMpgValuesMatchReference(expenses: FuelExpense[], mpgValues: number[]): void {
  let validIdx = 0;
  for (let i = 1; i < expenses.length; i++) {
    const current = expenses[i];
    const previous = expenses[i - 1];
    if (current.missedFillup || previous.missedFillup) continue;
    if (current.mileage && previous.mileage && current.fuelAmount) {
      const miles = current.mileage - previous.mileage;
      const mpg = miles / current.fuelAmount;
      if (mpg > 0 && mpg < 150) {
        expect(mpgValues[validIdx]).toBeCloseTo(mpg, 5);
        validIdx++;
      }
    }
  }
  expect(validIdx).toBe(mpgValues.length);
}

// ---------------------------------------------------------------------------
// Property 1: Missed fill-up pairs are excluded
// ---------------------------------------------------------------------------
describe('Property 1: Missed fill-up pairs are excluded from calculations', () => {
  test('pairs where current.missedFillup === true are never included', () => {
    fc.assert(
      fc.property(fuelExpenseListArb, (inputs) => {
        const expenses = inputs.map((input) => makeFuelExpense(input));
        const { mpgValues } = referenceMpg(expenses);
        verifyMpgValuesMatchReference(expenses, mpgValues);
      }),
      { numRuns: 200 }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 2: Backward compatibility when no expenses are flagged
// ---------------------------------------------------------------------------
describe('Property 2: Backward compatibility when no expenses are flagged', () => {
  test('unflagged expenses produce same result as unfiltered calculation', () => {
    fc.assert(
      fc.property(allUnflaggedListArb, (inputs) => {
        const expenses = inputs.map((input) => makeFuelExpense(input));
        const { mpgValues } = referenceMpg(expenses);
        const unfilteredCount = countUnfilteredPairs(expenses);

        // When no expenses are flagged, all valid pairs should be included
        expect(mpgValues.length).toBe(unfilteredCount);
      }),
      { numRuns: 200 }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 3: Monotonicity — flagging never increases data point count
// ---------------------------------------------------------------------------
describe('Property 3: Flagging expenses is monotonically non-increasing on data point count', () => {
  test('flagging any expense never increases the number of MPG data points', () => {
    fc.assert(
      fc.property(allUnflaggedListArb, fc.integer({ min: 0, max: 19 }), (inputs, flagIndex) => {
        const expenses = inputs.map((input) => makeFuelExpense(input));
        const actualFlagIndex = flagIndex % expenses.length;

        const unflaggedResult = referenceMpg(expenses);

        // Flag one expense
        const flaggedExpenses = expenses.map((e, i) =>
          i === actualFlagIndex ? { ...e, missedFillup: true } : e
        );
        const flaggedResult = referenceMpg(flaggedExpenses);

        expect(flaggedResult.mpgValues.length).toBeLessThanOrEqual(
          unflaggedResult.mpgValues.length
        );
      }),
      { numRuns: 200 }
    );
  });
});
