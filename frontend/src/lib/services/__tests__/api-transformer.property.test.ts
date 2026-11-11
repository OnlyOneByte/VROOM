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

describe('transformer round-trip preservation', () => {
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
					const backendResponse = {
						...backend,
						id: 'test-id',
						userId: 'user-1',
						createdAt: new Date().toISOString(),
						updatedAt: new Date().toISOString()
					};
					const roundTripped = fromBackendExpense(backendResponse);

					expect(roundTripped.volume).toBe(expense.volume);
					expect(roundTripped.charge).toBeUndefined();
				}
			),
			{ numRuns: 100 }
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
						userId: 'user-1',
						createdAt: new Date().toISOString(),
						updatedAt: new Date().toISOString()
					};
					const roundTripped = fromBackendExpense(backendResponse);

					expect(roundTripped.charge).toBe(expense.charge);
					expect(roundTripped.volume).toBeUndefined();
				}
			),
			{ numRuns: 100 }
		);
	});
});

describe('Property 2: fuelType-based mutual exclusivity', () => {
	const backendExpenseArb = (fuelType: fc.Arbitrary<string>) =>
		fc.record({
			id: fc.uuid(),
			vehicleId: fc.uuid(),
			userId: fc.uuid(),
			category: fc.constantFrom(...CATEGORIES),
			tags: fc.constant([] as string[]),
			expenseAmount: fc.double({ min: 0.01, max: 100000, noNaN: true, noDefaultInfinity: true }),
			date: fc.constant('2024-06-15T12:00:00.000Z'),
			volume: fc.double({ min: 0.01, max: 10000, noNaN: true, noDefaultInfinity: true }),
			fuelType,
			createdAt: fc.constant(new Date().toISOString()),
			updatedAt: fc.constant(new Date().toISOString())
		});

	test('electric fuelType maps volume to charge, volume is undefined on result', () => {
		fc.assert(
			fc.property(backendExpenseArb(fc.constantFrom(...ELECTRIC_FUEL_TYPES)), backendExpense => {
				const result = fromBackendExpense(backendExpense);

				expect(result.charge).toBe(backendExpense.volume);
				expect(result.volume).toBeUndefined();
			}),
			{ numRuns: 100 }
		);
	});

	test('non-electric fuelType maps volume to volume, charge is undefined', () => {
		fc.assert(
			fc.property(
				backendExpenseArb(fc.constantFrom(...NON_ELECTRIC_FUEL_TYPES)),
				backendExpense => {
					const result = fromBackendExpense(backendExpense);

					expect(result.volume).toBe(backendExpense.volume);
					expect(result.charge).toBeUndefined();
				}
			),
			{ numRuns: 100 }
		);
	});

	test('volume and charge are never both defined for any fuelType', () => {
		const allFuelTypes = [...ELECTRIC_FUEL_TYPES, ...NON_ELECTRIC_FUEL_TYPES] as string[];
		fc.assert(
			fc.property(backendExpenseArb(fc.constantFrom(...allFuelTypes)), backendExpense => {
				const result = fromBackendExpense(backendExpense);
				const hasVolume = result.volume !== undefined;
				const hasCharge = result.charge !== undefined;

				expect(hasVolume !== hasCharge).toBe(true);

				if (isElectricFuelType(backendExpense.fuelType)) {
					expect(hasCharge).toBe(true);
					expect(hasVolume).toBe(false);
				} else {
					expect(hasVolume).toBe(true);
					expect(hasCharge).toBe(false);
				}
			}),
			{ numRuns: 100 }
		);
	});
});

// An emptied description is sent as null only on edit, so it can be cleared; create omits it.
describe('toBackendExpense description clear-on-edit', () => {
	const base = { vehicleId: 'v1', category: 'misc' as const, amount: 10 };

	test('create omits an empty/absent description (offline-safe, unchanged)', () => {
		expect('description' in toBackendExpense({ ...base })).toBe(false);
		expect('description' in toBackendExpense({ ...base, description: '' })).toBe(false);
	});

	test('edit sends null for an emptied description (so it clears)', () => {
		expect(toBackendExpense({ ...base, description: '' }, { isEdit: true }).description).toBe(null);
		expect(toBackendExpense({ ...base }, { isEdit: true }).description).toBe(null);
	});

	test('a non-empty description serializes identically on create and edit', () => {
		expect(toBackendExpense({ ...base, description: 'oil change' }).description).toBe('oil change');
		expect(
			toBackendExpense({ ...base, description: 'oil change' }, { isEdit: true }).description
		).toBe('oil change');
	});
});

// Offline-queued electric expenses must carry fuelType, or the charge is dropped on sync.
describe('toBackendExpense — charge survives only when fuelType is carried', () => {
	const electric = { vehicleId: 'v1', category: 'fuel' as const, amount: 30, charge: 42 };

	test('an electric entry without fuelType carries no energy value', () => {
		const out = toBackendExpense({ ...electric });
		expect(out.volume).toBeUndefined();
	});

	test('an electric entry WITH fuelType maps charge → backend volume (the fix carries it)', () => {
		const out = toBackendExpense({ ...electric, fuelType: 'Electric' });
		expect(out.volume).toBe(42);
		expect(out.fuelType).toBe('Electric');
	});

	test('a Level 2 (AC) charging entry also routes charge → volume', () => {
		const out = toBackendExpense({ ...electric, fuelType: 'Level 2 (AC)', charge: 18.5 });
		expect(out.volume).toBe(18.5);
	});

	test('a liquid-fuel entry keeps volume on the volume field (no false electric routing)', () => {
		const out = toBackendExpense({
			vehicleId: 'v1',
			category: 'fuel',
			amount: 50,
			volume: 40,
			fuelType: 'Diesel'
		});
		expect(out.volume).toBe(40);
		expect(out.fuelType).toBe('Diesel');
	});
});
