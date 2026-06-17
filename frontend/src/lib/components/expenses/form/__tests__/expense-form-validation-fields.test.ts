/**
 * Coverage for validateExpenseField's non-date branches + validateMileage (C201 guard ratchet —
 * expense-form-validation.ts was ~15% covered; only the C103 date slice had a test). These are PURE
 * (a ValidationContext in, an error-string-or-null out — no DOM/network), and carry real form rules:
 * the amount/volume/charge bounds, the fuel-vs-charging unit gating (electric fuelType routes to
 * `charge`, else `volume`), and — the load-bearing one — validateMileage's MONOTONICITY check (a
 * fuel entry's odometer must sit strictly between the nearest earlier-dated and later-dated entries).
 * A regression in that ordering logic would silently let out-of-order odometer readings through.
 */

import { describe, expect, test } from 'vitest';
import type { Vehicle } from '$lib/types';
import { validateExpenseField } from '../expense-form-validation';

type Ctx = Parameters<typeof validateExpenseField>[1];

function ctx(over: Partial<Ctx> = {}): Ctx {
	return {
		category: 'misc',
		vehicle: null,
		volumeUnit: 'liters',
		chargeUnit: 'kwh',
		allVehicleExpenses: [],
		formData: {},
		...over
	} as Ctx;
}

describe('validateExpenseField — required selects', () => {
	test('vehicleId: empty → "Please select a vehicle"; present → null', () => {
		expect(validateExpenseField('vehicleId', ctx({ formData: { vehicleId: '' } }))).toBe(
			'Please select a vehicle'
		);
		expect(validateExpenseField('vehicleId', ctx({ formData: { vehicleId: 'v1' } }))).toBeNull();
	});

	test('category: empty → "Please select a category"; present → null', () => {
		expect(validateExpenseField('category', ctx({ formData: { category: '' } }))).toBe(
			'Please select a category'
		);
		expect(validateExpenseField('category', ctx({ formData: { category: 'fuel' } }))).toBeNull();
	});

	test('tags is never validated here (returns null immediately)', () => {
		expect(validateExpenseField('tags', ctx({ formData: { tags: ['a', 'b'] } }))).toBeNull();
	});
});

describe('validateExpenseField — amount bounds', () => {
	test('zero / negative / empty → "Amount must be greater than 0"', () => {
		expect(validateExpenseField('amount', ctx({ formData: { amount: '0' } }))).toBe(
			'Amount must be greater than 0'
		);
		expect(validateExpenseField('amount', ctx({ formData: { amount: '-5' } }))).toBe(
			'Amount must be greater than 0'
		);
		expect(validateExpenseField('amount', ctx({ formData: { amount: '' } }))).toBe(
			'Amount must be greater than 0'
		);
	});

	test('over the 999999 cap → "Amount seems too large"', () => {
		expect(validateExpenseField('amount', ctx({ formData: { amount: '1000000' } }))).toBe(
			'Amount seems too large'
		);
	});

	test('a normal positive amount → null', () => {
		expect(validateExpenseField('amount', ctx({ formData: { amount: '42.50' } }))).toBeNull();
	});
});

describe('validateExpenseField — volume gating (fuel + non-electric only)', () => {
	test('non-fuel category skips volume entirely (null even when empty)', () => {
		expect(
			validateExpenseField('volume', ctx({ category: 'misc', formData: { volume: '' } }))
		).toBeNull();
	});

	test('fuel + liquid fuel: empty/zero → unit-labelled "required"; >1000 → "too large"; normal → null', () => {
		const base = { category: 'fuel', volumeUnit: 'liters' as const };
		expect(
			validateExpenseField(
				'volume',
				ctx({ ...base, formData: { fuelType: 'regular', volume: '' } })
			)
		).toContain('required for fuel expenses');
		expect(
			validateExpenseField(
				'volume',
				ctx({ ...base, formData: { fuelType: 'regular', volume: '2000' } })
			)
		).toContain('seems too large');
		expect(
			validateExpenseField(
				'volume',
				ctx({ ...base, formData: { fuelType: 'regular', volume: '40' } })
			)
		).toBeNull();
	});

	test('fuel + ELECTRIC fuelType skips volume (it routes to charge instead)', () => {
		// isElectricFuelType matches the exact ELECTRIC_FUEL_TYPES members ('Electric', 'Level 2 (AC)', …),
		// case-sensitive — so an electric fuelType makes the volume branch a no-op.
		expect(
			validateExpenseField(
				'volume',
				ctx({ category: 'fuel', formData: { fuelType: 'Electric', volume: '' } })
			)
		).toBeNull();
	});
});

describe('validateExpenseField — charge gating (fuel + electric only)', () => {
	test('fuel + electric: empty/zero → "required for charging"; >1000 → "too large"; normal → null', () => {
		const base = { category: 'fuel', chargeUnit: 'kwh' as const };
		expect(
			validateExpenseField(
				'charge',
				ctx({ ...base, formData: { fuelType: 'Electric', charge: '' } })
			)
		).toContain('required for charging expenses');
		expect(
			validateExpenseField(
				'charge',
				ctx({ ...base, formData: { fuelType: 'Electric', charge: '5000' } })
			)
		).toContain('seems too large');
		expect(
			validateExpenseField(
				'charge',
				ctx({ ...base, formData: { fuelType: 'Electric', charge: '60' } })
			)
		).toBeNull();
	});

	test('fuel + liquid fuelType skips charge (it routes to volume instead)', () => {
		expect(
			validateExpenseField(
				'charge',
				ctx({ category: 'fuel', formData: { fuelType: 'regular', charge: '' } })
			)
		).toBeNull();
	});
});

describe('validateExpenseField — fuelType length', () => {
	test('over 50 chars → error; within → null', () => {
		expect(validateExpenseField('fuelType', ctx({ formData: { fuelType: 'x'.repeat(51) } }))).toBe(
			'Fuel type must be 50 characters or less'
		);
		expect(validateExpenseField('fuelType', ctx({ formData: { fuelType: 'premium' } }))).toBeNull();
	});
});

describe('validateMileage (via the mileage field) — fuel monotonicity', () => {
	const fuelVehicle = { initialMileage: 10000 } as Vehicle;

	test('non-fuel category skips mileage validation entirely', () => {
		expect(
			validateExpenseField('mileage', ctx({ category: 'misc', formData: { mileage: '5' } }))
		).toBeNull();
	});

	test('fuel: empty/zero mileage is required', () => {
		expect(
			validateExpenseField('mileage', ctx({ category: 'fuel', formData: { mileage: '0' } }))
		).toBe('Mileage required for fuel expenses');
	});

	test('below the vehicle initialMileage is rejected', () => {
		expect(
			validateExpenseField(
				'mileage',
				ctx({ category: 'fuel', vehicle: fuelVehicle, formData: { mileage: '9000' } })
			)
		).toBe('Mileage cannot be less than initial mileage');
	});

	test('must exceed the max of all EARLIER-dated entries', () => {
		const c = ctx({
			category: 'fuel',
			vehicle: fuelVehicle,
			formData: { mileage: '20000', date: '2024-06-01' },
			allVehicleExpenses: [
				{ id: 'e1', date: '2024-05-01', mileage: 25000 } // earlier date, HIGHER odo
			]
		});
		expect(validateExpenseField('mileage', c)).toContain('must be greater than 25,000');
	});

	test('must be below the min of all LATER-dated entries', () => {
		const c = ctx({
			category: 'fuel',
			vehicle: fuelVehicle,
			formData: { mileage: '30000', date: '2024-06-01' },
			allVehicleExpenses: [
				{ id: 'e1', date: '2024-07-01', mileage: 28000 } // later date, LOWER odo
			]
		});
		expect(validateExpenseField('mileage', c)).toContain('must be less than 28,000');
	});

	test('a strictly-increasing reading between neighbors passes', () => {
		const c = ctx({
			category: 'fuel',
			vehicle: fuelVehicle,
			formData: { mileage: '26000', date: '2024-06-01' },
			allVehicleExpenses: [
				{ id: 'e1', date: '2024-05-01', mileage: 25000 }, // earlier, lower
				{ id: 'e2', date: '2024-07-01', mileage: 27000 } // later, higher
			]
		});
		expect(validateExpenseField('mileage', c)).toBeNull();
	});

	test('the row being edited (matching expenseId) is excluded from the neighbor checks', () => {
		// The only other entry IS this expense (same id) → it must not constrain itself.
		const c = ctx({
			category: 'fuel',
			vehicle: fuelVehicle,
			expenseId: 'self',
			formData: { mileage: '26000', date: '2024-06-01' },
			allVehicleExpenses: [{ id: 'self', date: '2024-05-01', mileage: 99999 }]
		});
		expect(validateExpenseField('mileage', c)).toBeNull();
	});
});
