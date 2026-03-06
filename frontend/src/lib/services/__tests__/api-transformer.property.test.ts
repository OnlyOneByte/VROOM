import { describe, expect, test } from 'vitest';
import fc from 'fast-check';
import { fromBackendExpense, toBackendExpense } from '../api-transformer';
import { ELECTRIC_FUEL_TYPES, isElectricFuelType } from '$lib/utils/units';

const NON_ELECTRIC_FUEL_TYPES = [
	'87 (Regular)',
	'89 (Mid-Grade)',
	'91 (Premium)',
	'93 (Super Premium)',
	'Diesel',
	'Ethanol-Free',
	'Other (Custom)'
] as const;

const CATEGORIES = [
	'fuel',
	'maintenance',
	'financial',
	'regulatory',
	'enhancement',
	'misc'
] as const;

/**
 * Property 1: Transformer round-trip preservation
 * Validates: Requirements 2.1, 2.2, 2.3, 2.7
 *
 * For any valid expense with a volume value and a non-electric fuelType,
 * or a charge value and an electric fuelType,
 * fromBackendExpense(toBackendExpense(expense)) preserves the energy value.
 */
describe('Property 1: Transformer round-trip preservation', () => {
	test('round-trip preserves volume for non-electric fuelType expenses', () => {
		fc.assert(
			fc.property(
				fc.record({
					vehicleId: fc.uuid(),
					category: fc.constantFrom(...CATEGORIES),
					amount: fc.double({ min: 0.01, max: 100000, noNaN: true, noDefaultInfinity: true }),
					volume: fc.double({ min: 0.01, max: 10000, noNaN: true, noDefaultInfinity: true }),
					fuelType: fc.constantFrom(...NON_ELECTRIC_FUEL_TYPES),
					date: fc.constant('2024-06-15T12:00:00.000Z')
				}),
				expense => {
					const backend = toBackendExpense(expense);
					// Simulate a backend response with required fields
					const backendResponse = {
						...backend,
						id: 'test-id',
						createdAt: new Date().toISOString(),
						updatedAt: new Date().toISOString()
					};
					const roundTripped = fromBackendExpense(backendResponse);

					expect(roundTripped.volume).toBe(expense.volume);
					expect(roundTripped.charge).toBeUndefined();
				}
			),
			{ numRuns: 200 }
		);
	});

	test('round-trip preserves charge for electric fuelType expenses', () => {
		fc.assert(
			fc.property(
				fc.record({
					vehicleId: fc.uuid(),
					category: fc.constantFrom(...CATEGORIES),
					amount: fc.double({ min: 0.01, max: 100000, noNaN: true, noDefaultInfinity: true }),
					charge: fc.double({ min: 0.01, max: 10000, noNaN: true, noDefaultInfinity: true }),
					fuelType: fc.constantFrom(...ELECTRIC_FUEL_TYPES),
					date: fc.constant('2024-06-15T12:00:00.000Z')
				}),
				expense => {
					const backend = toBackendExpense(expense);
					const backendResponse = {
						...backend,
						id: 'test-id',
						createdAt: new Date().toISOString(),
						updatedAt: new Date().toISOString()
					};
					const roundTripped = fromBackendExpense(backendResponse);

					expect(roundTripped.charge).toBe(expense.charge);
					expect(roundTripped.volume).toBeUndefined();
				}
			),
			{ numRuns: 200 }
		);
	});
});

/**
 * Property 2: fuelType-based mutual exclusivity
 * Validates: Requirements 2.5, 2.6
 *
 * For any backend expense with a non-null fuelAmount,
 * fromBackendExpense maps it to exactly one of volume or charge,
 * determined solely by isElectricFuelType(fuelType).
 * The two fields are never both defined on the same expense.
 */
describe('Property 2: fuelType-based mutual exclusivity', () => {
	const backendExpenseArb = (fuelType: fc.Arbitrary<string>) =>
		fc.record({
			id: fc.uuid(),
			vehicleId: fc.uuid(),
			category: fc.constantFrom(...CATEGORIES),
			tags: fc.constant([] as string[]),
			expenseAmount: fc.double({ min: 0.01, max: 100000, noNaN: true, noDefaultInfinity: true }),
			date: fc.constant('2024-06-15T12:00:00.000Z'),
			fuelAmount: fc.double({ min: 0.01, max: 10000, noNaN: true, noDefaultInfinity: true }),
			fuelType,
			createdAt: fc.constant(new Date().toISOString()),
			updatedAt: fc.constant(new Date().toISOString())
		});

	test('electric fuelType maps fuelAmount to charge, volume is undefined', () => {
		fc.assert(
			fc.property(backendExpenseArb(fc.constantFrom(...ELECTRIC_FUEL_TYPES)), backendExpense => {
				const result = fromBackendExpense(backendExpense);

				expect(result.charge).toBe(backendExpense.fuelAmount);
				expect(result.volume).toBeUndefined();
			}),
			{ numRuns: 200 }
		);
	});

	test('non-electric fuelType maps fuelAmount to volume, charge is undefined', () => {
		fc.assert(
			fc.property(
				backendExpenseArb(fc.constantFrom(...NON_ELECTRIC_FUEL_TYPES)),
				backendExpense => {
					const result = fromBackendExpense(backendExpense);

					expect(result.volume).toBe(backendExpense.fuelAmount);
					expect(result.charge).toBeUndefined();
				}
			),
			{ numRuns: 200 }
		);
	});

	test('volume and charge are never both defined for any fuelType', () => {
		const allFuelTypes = [...ELECTRIC_FUEL_TYPES, ...NON_ELECTRIC_FUEL_TYPES] as string[];
		fc.assert(
			fc.property(backendExpenseArb(fc.constantFrom(...allFuelTypes)), backendExpense => {
				const result = fromBackendExpense(backendExpense);
				const hasVolume = result.volume !== undefined;
				const hasCharge = result.charge !== undefined;

				// Exactly one must be defined (since fuelAmount is non-null)
				expect(hasVolume !== hasCharge).toBe(true);

				// The choice must match isElectricFuelType
				if (isElectricFuelType(backendExpense.fuelType)) {
					expect(hasCharge).toBe(true);
					expect(hasVolume).toBe(false);
				} else {
					expect(hasVolume).toBe(true);
					expect(hasCharge).toBe(false);
				}
			}),
			{ numRuns: 200 }
		);
	});
});
