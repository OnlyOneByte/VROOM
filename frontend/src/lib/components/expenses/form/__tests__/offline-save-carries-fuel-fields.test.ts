import { describe, expect, test } from 'vitest';
import { offlineExpenseToBackend, type OfflineExpense } from '$lib/utils/offline-storage';
import { toOfflineExpense, type ParsedExpenseForm } from '../offline-expense';

const BASE: ParsedExpenseForm = {
	vehicleId: 'v1',
	tags: ['commute'],
	category: 'fuel',
	amount: 42.5,
	date: '2026-03-04T12:00:00.000Z'
};

describe('toOfflineExpense', () => {
	test('carries fuelType so an electric charge survives sync', () => {
		const queued = toOfflineExpense({ ...BASE, fuelType: 'electric', charge: 30 });
		expect(queued.fuelType).toBe('electric');
		expect(queued.charge).toBe(30);
		expect(queued).not.toHaveProperty('volume');
	});

	test('carries missedFillup, including false, so MPG pairing stays correct', () => {
		expect(toOfflineExpense({ ...BASE, missedFillup: true }).missedFillup).toBe(true);
		expect(toOfflineExpense({ ...BASE, missedFillup: false }).missedFillup).toBe(false);
	});

	test('carries every entered numeric field and the identity fields', () => {
		expect(
			toOfflineExpense({
				...BASE,
				mileage: 12000,
				volume: 11.2,
				fuelType: 'regular',
				description: 'Costco',
				missedFillup: false
			})
		).toEqual({
			...BASE,
			mileage: 12000,
			volume: 11.2,
			fuelType: 'regular',
			description: 'Costco',
			missedFillup: false
		});
	});

	test('carries the location through the queue to the synced request', () => {
		const queued = toOfflineExpense({ ...BASE, location: 'Shell on Main St' });
		expect(queued.location).toBe('Shell on Main St');
		const stored: OfflineExpense = { ...queued, id: 'o1', timestamp: 0, synced: false };
		expect(offlineExpenseToBackend(stored).location).toBe('Shell on Main St');
	});

	test('omits unentered optional fields and defaults description to empty', () => {
		expect(toOfflineExpense(BASE)).toEqual({ ...BASE, description: '' });
	});
});
