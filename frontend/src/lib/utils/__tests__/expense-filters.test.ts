import { describe, expect, test } from 'vitest';
import { hasActiveFilters, extractUniqueTags } from '../expense-filters';
import type { Expense, ExpenseFilters } from '$lib/types';

const NO_FILTERS: ExpenseFilters = {};

function storedDate(year: number, month: number, day: number): string {
	return new Date(year, month - 1, day, 12, 0, 0).toISOString();
}

function expense(over: Partial<Expense> = {}): Expense {
	return {
		id: over.id ?? 'e1',
		vehicleId: over.vehicleId ?? 'v1',
		userId: 'u1',
		tags: over.tags ?? [],
		category: over.category ?? 'misc',
		amount: over.amount ?? 10,
		date: over.date ?? storedDate(2024, 6, 15),
		description: over.description,
		createdAt: '2024-06-15T00:00:00.000Z',
		updatedAt: '2024-06-15T00:00:00.000Z'
	} as Expense;
}

describe('hasActiveFilters', () => {
	test('false when empty', () => {
		expect(hasActiveFilters('', NO_FILTERS)).toBe(false);
		expect(hasActiveFilters('   ', { tags: [] })).toBe(false);
	});

	test('true for each active dimension', () => {
		expect(hasActiveFilters('x', NO_FILTERS)).toBe(true);
		expect(hasActiveFilters('', { category: 'fuel' })).toBe(true);
		expect(hasActiveFilters('', { tags: ['a'] })).toBe(true);
		expect(hasActiveFilters('', { startDate: '2024-01-01' })).toBe(true);
		expect(hasActiveFilters('', { endDate: '2024-01-01' })).toBe(true);
	});
});

describe('extractUniqueTags', () => {
	test('dedups across expenses and sorts ascending', () => {
		const list = [
			expense({ tags: ['tolls', 'highway'] }),
			expense({ tags: ['highway', 'fuel'] }),
			expense({ tags: [] })
		];
		expect(extractUniqueTags(list)).toEqual(['fuel', 'highway', 'tolls']);
	});

	test('empty list → empty array', () => {
		expect(extractUniqueTags([])).toEqual([]);
	});
});
