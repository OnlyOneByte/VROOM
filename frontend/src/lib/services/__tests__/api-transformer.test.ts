import { describe, expect, test } from 'vitest';
import type { BackendExpenseResponse } from '#lib/types/index.ts';
import { fromBackendExpense, toBackendExpense } from '../api-transformer';

function backend(over: Partial<BackendExpenseResponse> = {}): BackendExpenseResponse {
	return {
		id: 'e1',
		vehicleId: 'v1',
		userId: 'u1',
		tags: ['fuel'],
		category: 'fuel',
		expenseAmount: 40,
		date: '2025-01-15T00:00:00.000Z',
		createdAt: '2025-01-15T00:00:00.000Z',
		updatedAt: '2025-01-15T00:00:00.000Z',
		...over
	};
}

describe('toBackendExpense', () => {
	test('maps amount to expenseAmount and defaults tags', () => {
		const result = toBackendExpense({
			vehicleId: 'v1',
			category: 'maintenance',
			amount: 99,
			date: '2025-02-01T00:00:00.000Z'
		});
		expect(result).toEqual({
			vehicleId: 'v1',
			tags: [],
			category: 'maintenance',
			expenseAmount: 99,
			date: '2025-02-01T00:00:00.000Z'
		});
	});

	test('defaults a missing date to now as an ISO string', () => {
		const result = toBackendExpense({ vehicleId: 'v1', category: 'misc', amount: 1 });
		expect(result.date).toMatch(/^\d{4}-\d{2}-\d{2}T/);
	});

	test('electric expenses send charge as volume and ignore volume', () => {
		const result = toBackendExpense({
			vehicleId: 'v1',
			category: 'fuel',
			amount: 12,
			fuelType: 'Electric',
			charge: 30,
			volume: 5
		});
		expect(result.volume).toBe(30);
		expect(result.fuelType).toBe('Electric');
	});

	test('electric expenses without charge send no volume', () => {
		const result = toBackendExpense({
			vehicleId: 'v1',
			category: 'fuel',
			amount: 12,
			fuelType: 'Electric',
			volume: 5
		});
		expect(result.volume).toBeUndefined();
	});

	test('passes mileage, source, and missedFillup through when present', () => {
		const result = toBackendExpense({
			vehicleId: 'v1',
			category: 'financial',
			amount: 300,
			mileage: 0,
			sourceType: 'financing',
			sourceId: 'fin-1',
			missedFillup: false,
			description: 'Loan payment'
		});
		expect(result).toMatchObject({
			mileage: 0,
			sourceType: 'financing',
			sourceId: 'fin-1',
			missedFillup: false,
			description: 'Loan payment'
		});
	});

	test('an edit with an emptied description clears it with null', () => {
		const result = toBackendExpense(
			{ vehicleId: 'v1', category: 'misc', amount: 1, description: '' },
			{ isEdit: true }
		);
		expect(result.description).toBeNull();
	});

	test('a create with no description omits it', () => {
		const result = toBackendExpense({ vehicleId: 'v1', category: 'misc', amount: 1 });
		expect('description' in result).toBe(false);
		expect('sourceType' in result).toBe(false);
	});
});

describe('fromBackendExpense', () => {
	test('copies split, source and optional fields through', () => {
		const result = fromBackendExpense(
			backend({
				mileage: 1_000,
				fuelType: 'Regular',
				description: 'Fill',
				groupId: 'g1',
				groupTotal: 80,
				splitMethod: 'even',
				sourceType: 'financing',
				sourceId: 'fin-1',
				missedFillup: true
			})
		);
		expect(result).toMatchObject({
			amount: 40,
			mileage: 1_000,
			fuelType: 'Regular',
			description: 'Fill',
			groupId: 'g1',
			groupTotal: 80,
			splitMethod: 'even',
			sourceType: 'financing',
			sourceId: 'fin-1',
			missedFillup: true
		});
	});

	test('defaults missing tags and missedFillup and leaves absent fields undefined', () => {
		const result = fromBackendExpense(
			backend({ tags: undefined as unknown as string[], description: null })
		);
		expect(result.tags).toEqual([]);
		expect(result.missedFillup).toBe(false);
		expect(result.description).toBeUndefined();
		expect(result.groupId).toBeUndefined();
		expect(result.groupTotal).toBeUndefined();
		expect(result.splitMethod).toBeUndefined();
		expect(result.sourceType).toBeUndefined();
	});

	test('a groupTotal of zero is preserved', () => {
		expect(fromBackendExpense(backend({ groupTotal: 0 })).groupTotal).toBe(0);
	});
});
