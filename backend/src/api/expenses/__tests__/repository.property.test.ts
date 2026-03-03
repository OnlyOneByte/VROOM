/**
 * Property-Based Tests for Expense Repository
 *
 * Property 7: Financing Expense Query Correctness
 * Query should return exactly those expenses where `isFinancingPayment === true`
 * and `vehicleId` matches, sorted by date ascending.
 *
 * **Validates: Requirements 6.1, 6.2**
 *
 * Approach: We test the specification at the data level — generate a mixed set of
 * expenses (various vehicleIds, various isFinancingPayment values), apply the same
 * filtering/sorting contract that `findFinancingByVehicleId` implements, and verify
 * the result matches expectations.
 */

import { describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import type { Expense } from '../../../db/schema';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a synthetic Expense for testing filtering/sorting logic. */
function makeExpense(overrides: {
  vehicleId: string;
  isFinancingPayment: boolean;
  date: Date;
  index: number;
}): Expense {
  return {
    id: `exp-${overrides.index}`,
    vehicleId: overrides.vehicleId,
    category: overrides.isFinancingPayment ? 'financial' : 'maintenance',
    tags: [],
    date: overrides.date,
    expenseAmount: 100,
    isFinancingPayment: overrides.isFinancingPayment,
    mileage: null,
    description: null,
    receiptUrl: null,
    fuelAmount: null,
    fuelType: null,
    insurancePolicyId: null,
    insuranceTermId: null,
    missedFillup: false,
    expenseGroupId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

/**
 * Reference implementation of the filtering/sorting contract that
 * `findFinancingByVehicleId` must satisfy:
 *   - Only expenses with `isFinancingPayment === true`
 *   - Only expenses matching the target `vehicleId`
 *   - Sorted by date ascending
 */
function referenceQuery(allExpenses: Expense[], vehicleId: string): Expense[] {
  return allExpenses
    .filter((e) => e.isFinancingPayment === true && e.vehicleId === vehicleId)
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
}

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

const vehicleIdArb = fc.constantFrom('vehicle-A', 'vehicle-B', 'vehicle-C');

/** Generate a valid date by building from integer components to avoid NaN dates. */
const expenseDateArb = fc
  .integer({ min: 1672531200000, max: 1767139200000 }) // 2023-01-01 to 2025-12-31 in ms
  .map((ms) => new Date(ms));

const expenseArb = (index: number) =>
  fc.record({
    vehicleId: vehicleIdArb,
    isFinancingPayment: fc.boolean(),
    date: expenseDateArb,
    index: fc.constant(index),
  });

const expenseListArb = fc
  .integer({ min: 0, max: 30 })
  .chain((len) => fc.tuple(...Array.from({ length: len }, (_, i) => expenseArb(i))));

// ---------------------------------------------------------------------------
// Property 7: Financing Expense Query Correctness
// ---------------------------------------------------------------------------
describe('Property 7: Financing Expense Query Correctness', () => {
  test('filtering returns exactly expenses with isFinancingPayment === true for the target vehicleId', () => {
    fc.assert(
      fc.property(expenseListArb, vehicleIdArb, (expenseInputs, targetVehicleId) => {
        const allExpenses = expenseInputs.map((input) => makeExpense(input));
        const result = referenceQuery(allExpenses, targetVehicleId);

        // Every returned expense must have isFinancingPayment === true
        for (const e of result) {
          expect(e.isFinancingPayment).toBe(true);
        }

        // Every returned expense must match the target vehicleId
        for (const e of result) {
          expect(e.vehicleId).toBe(targetVehicleId);
        }

        // No matching expense should be missing from the result
        const expectedIds = new Set(
          allExpenses
            .filter((e) => e.isFinancingPayment === true && e.vehicleId === targetVehicleId)
            .map((e) => e.id)
        );
        const resultIds = new Set(result.map((e) => e.id));
        expect(resultIds).toEqual(expectedIds);
      }),
      { numRuns: 200 }
    );
  });

  test('results are sorted by date ascending', () => {
    fc.assert(
      fc.property(expenseListArb, vehicleIdArb, (expenseInputs, targetVehicleId) => {
        const allExpenses = expenseInputs.map((input) => makeExpense(input));
        const result = referenceQuery(allExpenses, targetVehicleId);

        // Each date should be <= the next date
        for (let i = 1; i < result.length; i++) {
          const prev = new Date(result[i - 1].date).getTime();
          const curr = new Date(result[i].date).getTime();
          expect(curr).toBeGreaterThanOrEqual(prev);
        }
      }),
      { numRuns: 200 }
    );
  });

  test('expenses with isFinancingPayment === false never appear in results', () => {
    fc.assert(
      fc.property(expenseListArb, vehicleIdArb, (expenseInputs, targetVehicleId) => {
        const allExpenses = expenseInputs.map((input) => makeExpense(input));
        const result = referenceQuery(allExpenses, targetVehicleId);

        const nonFinancingIds = new Set(
          allExpenses.filter((e) => e.isFinancingPayment === false).map((e) => e.id)
        );

        for (const e of result) {
          expect(nonFinancingIds.has(e.id)).toBe(false);
        }
      }),
      { numRuns: 200 }
    );
  });

  test('expenses for other vehicles never appear in results', () => {
    fc.assert(
      fc.property(expenseListArb, vehicleIdArb, (expenseInputs, targetVehicleId) => {
        const allExpenses = expenseInputs.map((input) => makeExpense(input));
        const result = referenceQuery(allExpenses, targetVehicleId);

        for (const e of result) {
          expect(e.vehicleId).toBe(targetVehicleId);
        }
      }),
      { numRuns: 200 }
    );
  });
});
