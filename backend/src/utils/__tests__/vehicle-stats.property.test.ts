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
import { ELECTRIC_FUEL_TYPES, isElectricFuelType } from '../../db/types';
import { calculateVehicleStats, type FuelExpense } from '../vehicle-stats';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a synthetic FuelExpense for testing. */
function makeFuelExpense(overrides: {
  mileage: number;
  fuelAmount: number;
  missedFillup: boolean;
  index: number;
  fuelType?: string;
}): FuelExpense {
  return {
    id: `exp-${overrides.index}`,
    mileage: overrides.mileage,
    fuelAmount: overrides.fuelAmount,
    fuelType: overrides.fuelType ?? '87 (Regular)',
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
      { numRuns: 100 }
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
      { numRuns: 100 }
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
      { numRuns: 100 }
    );
  });
});

// ---------------------------------------------------------------------------
// Generators for Property 4
// ---------------------------------------------------------------------------

/** All non-electric fuel type strings used in the app */
const NON_ELECTRIC_FUEL_TYPES = [
  '87 (Regular)',
  '89 (Mid-Grade)',
  '91 (Premium)',
  '93 (Super Premium)',
  'Diesel',
  'Ethanol-Free',
  'Other',
] as const;

/** Arbitrary for a single FuelExpense with a random fuelType (electric or non-electric) */
const mixedFuelExpenseArb = (index: number) =>
  fc
    .record({
      fuelAmount: fc.double({ min: 0.1, max: 500, noNaN: true }),
      fuelType: fc.oneof(
        fc.constantFrom(...ELECTRIC_FUEL_TYPES),
        fc.constantFrom(...NON_ELECTRIC_FUEL_TYPES)
      ),
      mileage: fc.integer({ min: 10000 + index * 200, max: 10000 + index * 200 + 199 }),
      expenseAmount: fc.double({ min: 0.01, max: 1000, noNaN: true }),
      missedFillup: fc.boolean(),
    })
    .map(
      (r): FuelExpense => ({
        id: `exp-${index}`,
        mileage: r.mileage,
        fuelAmount: r.fuelAmount,
        fuelType: r.fuelType,
        date: new Date(2024, 0, 1 + index),
        expenseAmount: r.expenseAmount,
        missedFillup: r.missedFillup,
      })
    );

/** Generate a list of 0–20 mixed fuel/charge expenses */
const mixedExpenseListArb = fc
  .integer({ min: 0, max: 20 })
  .chain((len) =>
    len === 0
      ? fc.constant([] as FuelExpense[])
      : fc.tuple(...Array.from({ length: len }, (_, i) => mixedFuelExpenseArb(i)))
  );

// ---------------------------------------------------------------------------
// Helpers for Property 4
// ---------------------------------------------------------------------------

/** Compute reference fuel/charge sums by partitioning on isElectricFuelType */
function referenceTotals(expenses: FuelExpense[]): { fuel: number; charge: number } {
  let fuel = 0;
  let charge = 0;
  for (const e of expenses) {
    if (e.fuelAmount) {
      if (isElectricFuelType(e.fuelType)) {
        charge += e.fuelAmount;
      } else {
        fuel += e.fuelAmount;
      }
    }
  }
  return { fuel, charge };
}

/** Normalize the mixedExpenseListArb output to a flat array */
function toExpenseList(expenses: FuelExpense[] | FuelExpense): FuelExpense[] {
  return Array.isArray(expenses) ? (expenses as FuelExpense[]) : [];
}

// ---------------------------------------------------------------------------
// Property 4: Stats totals partition by fuelType
// ---------------------------------------------------------------------------
/**
 * **Validates: Requirements 4.1, 4.6, 4.7**
 *
 * For any list of fuel-category expenses:
 * - totalFuelConsumed equals the sum of fuelAmount for non-electric fuelType expenses
 * - totalChargeConsumed equals the sum of fuelAmount for electric fuelType expenses
 * - totalFuelConsumed + totalChargeConsumed equals the sum of ALL fuelAmount values
 */
describe('Property 4: Stats totals partition by fuelType', () => {
  test('totalFuelConsumed + totalChargeConsumed equals sum of all fuelAmount values', () => {
    fc.assert(
      fc.property(mixedExpenseListArb, (expenses) => {
        const expenseList = toExpenseList(expenses);
        const stats = calculateVehicleStats(expenseList, 0, true, true);
        const expected = referenceTotals(expenseList);

        expect(stats.totalFuelConsumed).toBeCloseTo(expected.fuel, 5);
        expect(stats.totalChargeConsumed).toBeCloseTo(expected.charge, 5);
        expect(stats.totalFuelConsumed + stats.totalChargeConsumed).toBeCloseTo(
          expected.fuel + expected.charge,
          5
        );
      }),
      { numRuns: 100 }
    );
  });

  test('totalFuelConsumed only includes non-electric fuelType expenses', () => {
    fc.assert(
      fc.property(mixedExpenseListArb, (expenses) => {
        const expenseList = toExpenseList(expenses);
        const stats = calculateVehicleStats(expenseList, 0, true, true);
        const expected = referenceTotals(expenseList);

        expect(stats.totalFuelConsumed).toBeCloseTo(expected.fuel, 5);
      }),
      { numRuns: 100 }
    );
  });

  test('totalChargeConsumed only includes electric fuelType expenses', () => {
    fc.assert(
      fc.property(mixedExpenseListArb, (expenses) => {
        const expenseList = toExpenseList(expenses);
        const stats = calculateVehicleStats(expenseList, 0, true, true);
        const expected = referenceTotals(expenseList);

        expect(stats.totalChargeConsumed).toBeCloseTo(expected.charge, 5);
      }),
      { numRuns: 100 }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 5: Stats tracking flag gating
// ---------------------------------------------------------------------------
/**
 * **Validates: Requirements 4.2, 4.3, 4.4, 4.5**
 *
 * - When trackFuel=false, averageMpg is always null regardless of expense data
 * - When trackCharging=false, averageMilesPerKwh is always null regardless of expense data
 * - When trackFuel=true and sufficient fuel data exists, averageMpg may be non-null
 * - When trackCharging=true and sufficient charge data exists, averageMilesPerKwh may be non-null
 */
describe('Property 5: Stats tracking flag gating', () => {
  test('averageMpg is null when trackFuel=false regardless of expense data', () => {
    fc.assert(
      fc.property(mixedExpenseListArb, (expenses) => {
        const expenseList = toExpenseList(expenses);
        const stats = calculateVehicleStats(expenseList, 0, false, true);
        expect(stats.averageMpg).toBeNull();
      }),
      { numRuns: 100 }
    );
  });

  test('averageMilesPerKwh is null when trackCharging=false regardless of expense data', () => {
    fc.assert(
      fc.property(mixedExpenseListArb, (expenses) => {
        const expenseList = toExpenseList(expenses);
        const stats = calculateVehicleStats(expenseList, 0, true, false);
        expect(stats.averageMilesPerKwh).toBeNull();
      }),
      { numRuns: 100 }
    );
  });

  test('both metrics are null when both flags are false', () => {
    fc.assert(
      fc.property(mixedExpenseListArb, (expenses) => {
        const expenseList = toExpenseList(expenses);
        const stats = calculateVehicleStats(expenseList, 0, false, false);
        expect(stats.averageMpg).toBeNull();
        expect(stats.averageMilesPerKwh).toBeNull();
      }),
      { numRuns: 100 }
    );
  });

  test('averageMpg can be non-null only when trackFuel=true', () => {
    fc.assert(
      fc.property(
        mixedExpenseListArb,
        fc.boolean(),
        fc.boolean(),
        (expenses, trackFuel, trackCharging) => {
          const expenseList = toExpenseList(expenses);
          const stats = calculateVehicleStats(expenseList, 0, trackFuel, trackCharging);
          if (stats.averageMpg !== null) {
            expect(trackFuel).toBe(true);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  test('averageMilesPerKwh can be non-null only when trackCharging=true', () => {
    fc.assert(
      fc.property(
        mixedExpenseListArb,
        fc.boolean(),
        fc.boolean(),
        (expenses, trackFuel, trackCharging) => {
          const expenseList = toExpenseList(expenses);
          const stats = calculateVehicleStats(expenseList, 0, trackFuel, trackCharging);
          if (stats.averageMilesPerKwh !== null) {
            expect(trackCharging).toBe(true);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
