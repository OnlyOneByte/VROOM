/**
 * Property-Based Tests for expense-helpers.ts — prepareFuelEfficiencyData
 *
 * Property 1: Missed fill-up pairs are excluded from chart data
 * Property 2: Backward compatibility when no expenses are flagged
 * Property 3: Monotonicity — flagging expenses never increases data point count
 *
 * Validates: Requirements 4.1, 4.2, 4.3, 4.4
 */

import { describe, expect, test } from 'vitest';
import fc from 'fast-check';
import type { Expense } from '$lib/types';
import { prepareFuelEfficiencyData } from '../expense-helpers';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a synthetic Expense for testing prepareFuelEfficiencyData. */
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
		tags: ['fuel'],
		amount: overrides.volume * 3.5,
		date: new Date(2024, 0, 1 + overrides.index).toISOString(),
		mileage: overrides.mileage,
		volume: overrides.volume,
		fuelType: '87 (Regular)',
		isFinancingPayment: false,
		missedFillup: overrides.missedFillup,
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString()
	};
}

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

const expenseListArb = fc.integer({ min: 2, max: 20 }).chain(len =>
	fc.tuple(
		...Array.from({ length: len }, (_, i) =>
			fc.record({
				mileage: fc.integer({ min: 10000 + i * 200, max: 10000 + i * 200 + 199 }),
				volume: fc.double({ min: 5, max: 25, noNaN: true }),
				missedFillup: fc.boolean(),
				index: fc.constant(i)
			})
		)
	)
);

const allUnflaggedListArb = fc.integer({ min: 2, max: 20 }).chain(len =>
	fc.tuple(
		...Array.from({ length: len }, (_, i) =>
			fc.record({
				mileage: fc.integer({ min: 10000 + i * 200, max: 10000 + i * 200 + 199 }),
				volume: fc.double({ min: 5, max: 25, noNaN: true }),
				missedFillup: fc.constant(false),
				index: fc.constant(i)
			})
		)
	)
);

// ---------------------------------------------------------------------------
// Property 1: Missed fill-up pairs are excluded
// ---------------------------------------------------------------------------
describe('Property 1: Missed fill-up pairs are excluded from chart data', () => {
	test('all missed pairs produce empty result', () => {
		const expenses = [
			makeExpense({ mileage: 10000, volume: 10, missedFillup: true, index: 0 }),
			makeExpense({ mileage: 10300, volume: 12, missedFillup: true, index: 1 }),
			makeExpense({ mileage: 10600, volume: 11, missedFillup: true, index: 2 })
		];
		expect(prepareFuelEfficiencyData(expenses)).toEqual([]);
	});

	test('data points from missed pairs are never included', () => {
		fc.assert(
			fc.property(expenseListArb, inputs => {
				const expenses = inputs.map(input => makeExpense(input));
				const result = prepareFuelEfficiencyData(expenses);

				// Build a set of dates that should be excluded (current in a missed pair)
				const sorted = [...expenses].sort(
					(a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
				);

				const excludedDates = new Set<string>();
				for (let i = 1; i < sorted.length; i++) {
					const current = sorted[i]!;
					const previous = sorted[i - 1]!;
					if (!current || !previous) continue;
					if (current.missedFillup || previous.missedFillup) {
						excludedDates.add(current.date);
					}
				}

				// No result data point should have a date from an excluded pair
				for (const dp of result) {
					const dpISO = dp.date.toISOString();
					expect(excludedDates.has(dpISO)).toBe(false);
				}
			}),
			{ numRuns: 200 }
		);
	});
});

// ---------------------------------------------------------------------------
// Property 2: Backward compatibility when no expenses are flagged
// ---------------------------------------------------------------------------
describe('Property 2: Backward compatibility for prepareFuelEfficiencyData', () => {
	test('unflagged expenses produce same count as unfiltered', () => {
		fc.assert(
			fc.property(allUnflaggedListArb, inputs => {
				const expenses = inputs.map(input => makeExpense(input));
				const withFlag = prepareFuelEfficiencyData(expenses);

				// Create identical expenses without the missedFillup field
				const withoutFlag = prepareFuelEfficiencyData(
					expenses.map(e => ({ ...e, missedFillup: undefined }))
				);

				expect(withFlag.length).toBe(withoutFlag.length);
			}),
			{ numRuns: 200 }
		);
	});
});

// ---------------------------------------------------------------------------
// Property 3: Monotonicity — flagging never increases data point count
// ---------------------------------------------------------------------------
describe('Property 3: Flagging expenses is monotonically non-increasing on data point count', () => {
	test('flagging any expense never increases the number of chart data points', () => {
		fc.assert(
			fc.property(allUnflaggedListArb, fc.integer({ min: 0, max: 19 }), (inputs, flagIndex) => {
				const expenses = inputs.map(input => makeExpense(input));
				const actualFlagIndex = flagIndex % expenses.length;

				const unflaggedResult = prepareFuelEfficiencyData(expenses);

				const flaggedExpenses = expenses.map((e, i) =>
					i === actualFlagIndex ? { ...e, missedFillup: true } : e
				);
				const flaggedResult = prepareFuelEfficiencyData(flaggedExpenses);

				expect(flaggedResult.length).toBeLessThanOrEqual(unflaggedResult.length);
			}),
			{ numRuns: 200 }
		);
	});
});
