import { describe, expect, test } from 'vitest';
import { toBackendExpense } from '../api-transformer';
import type { ExpenseCategory } from '#lib/types/index.ts';

const fuel = {
	vehicleId: 'v1',
	category: 'fuel' as ExpenseCategory,
	amount: 40,
	volume: 10,
	mileage: 1000
};

describe('api-transformer fuelType mapping', () => {
	test('sends a selected fuel type', () => {
		expect(toBackendExpense({ ...fuel, fuelType: 'Premium' }).fuelType).toBe('Premium');
	});

	test('sends fuelType:null on an edit that clears it', () => {
		const out = toBackendExpense({ ...fuel, fuelType: undefined }, { isEdit: true });
		expect(out.fuelType).toBeNull();
		expect(out.volume).toBe(10);
	});

	test('omits fuelType on a create with none selected', () => {
		expect('fuelType' in toBackendExpense({ ...fuel, fuelType: undefined })).toBe(false);
	});
});
