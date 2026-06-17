/**
 * Unit tests for expense-filters — the pure client-side filtering used by the
 * expenses list. No DOM / store / IO coupling, so this is straight input→output.
 *
 * Pins the behavior that's easy to break in a refactor:
 *   - search matches across description / tags / category / amount (as a
 *     SUBSTRING of the stringified amount — "5" matches 5, 50, 15.50), case-insensitively
 *   - category / tags (any-match) / date-range (INCLUSIVE on both ends) filters
 *   - the no-filters fast-path returns the original array reference
 *   - hasActiveFilters mirrors the same predicate
 *   - extractUniqueTags dedups + sorts
 */

import { describe, expect, test } from 'vitest';
import { filterExpenses, hasActiveFilters, extractUniqueTags } from '../expense-filters';
import type { Expense, ExpenseFilters } from '$lib/types';

const NO_FILTERS: ExpenseFilters = {};

/** Minimal typed Expense factory — only the fields the filters read matter. */
function expense(over: Partial<Expense> = {}): Expense {
	return {
		id: over.id ?? 'e1',
		vehicleId: over.vehicleId ?? 'v1',
		userId: 'u1',
		tags: over.tags ?? [],
		category: over.category ?? 'misc',
		amount: over.amount ?? 10,
		date: over.date ?? '2024-06-15T00:00:00.000Z',
		description: over.description,
		createdAt: '2024-06-15T00:00:00.000Z',
		updatedAt: '2024-06-15T00:00:00.000Z'
	} as Expense;
}

describe('filterExpenses — no filters fast path', () => {
	test('returns the SAME array reference when nothing is filtered', () => {
		const list = [expense({ id: 'a' }), expense({ id: 'b' })];
		const out = filterExpenses(list, '', NO_FILTERS);
		expect(out).toBe(list); // identity — proves the early return, not a copy
	});

	test('whitespace-only search does NOT hit the fast path but returns equal contents', () => {
		// The fast path guards on `!searchTerm`, and '   ' is truthy, so it falls
		// through and copies the array; the search itself is skipped because
		// `searchTerm.trim()` is empty. Result: a NEW array with the same items.
		const list = [expense({ id: 'a' }), expense({ id: 'b' })];
		const out = filterExpenses(list, '   ', NO_FILTERS);
		expect(out).not.toBe(list); // a copy, not the original reference
		expect(out.map(e => e.id)).toEqual(['a', 'b']); // contents unchanged
	});
});

describe('filterExpenses — search', () => {
	const list = [
		expense({ id: 'a', description: 'Shell premium', category: 'fuel', amount: 52.4 }),
		expense({ id: 'b', description: 'Oil change', category: 'maintenance', amount: 120 }),
		expense({ id: 'c', tags: ['tolls', 'highway'], category: 'misc', amount: 7 })
	];

	test('matches description, case-insensitively', () => {
		expect(filterExpenses(list, 'shell', NO_FILTERS).map(e => e.id)).toEqual(['a']);
		expect(filterExpenses(list, 'SHELL', NO_FILTERS).map(e => e.id)).toEqual(['a']);
	});

	test('matches a tag', () => {
		expect(filterExpenses(list, 'toll', NO_FILTERS).map(e => e.id)).toEqual(['c']);
	});

	test('matches category', () => {
		expect(filterExpenses(list, 'maintenance', NO_FILTERS).map(e => e.id)).toEqual(['b']);
	});

	test('matches amount as a substring of the stringified value', () => {
		// "52" → 52.4 only; "12" → 120 only; "7" → the amount 7.
		expect(filterExpenses(list, '52', NO_FILTERS).map(e => e.id)).toEqual(['a']);
		expect(filterExpenses(list, '12', NO_FILTERS).map(e => e.id)).toEqual(['b']);
		expect(filterExpenses(list, '7', NO_FILTERS).map(e => e.id)).toEqual(['c']);
	});

	test('no match yields an empty array', () => {
		expect(filterExpenses(list, 'zzz-nope', NO_FILTERS)).toEqual([]);
	});
});

describe('filterExpenses — structured filters', () => {
	const list = [
		expense({ id: 'a', category: 'fuel', tags: ['regular'], date: '2024-01-10T00:00:00.000Z' }),
		expense({ id: 'b', category: 'fuel', tags: ['premium'], date: '2024-06-15T00:00:00.000Z' }),
		expense({ id: 'c', category: 'maintenance', tags: ['oil'], date: '2024-12-31T00:00:00.000Z' })
	];

	test('category filter', () => {
		expect(filterExpenses(list, '', { category: 'fuel' }).map(e => e.id)).toEqual(['a', 'b']);
	});

	test('tags filter is any-match', () => {
		expect(filterExpenses(list, '', { tags: ['oil', 'regular'] }).map(e => e.id).sort()).toEqual([
			'a',
			'c'
		]);
	});

	test('startDate is inclusive', () => {
		// Boundary: an expense exactly on startDate is kept.
		expect(
			filterExpenses(list, '', { startDate: '2024-06-15T00:00:00.000Z' }).map(e => e.id)
		).toEqual(['b', 'c']);
	});

	test('endDate is inclusive', () => {
		expect(
			filterExpenses(list, '', { endDate: '2024-06-15T00:00:00.000Z' }).map(e => e.id)
		).toEqual(['a', 'b']);
	});

	test('start + end define a closed range', () => {
		expect(
			filterExpenses(list, '', {
				startDate: '2024-02-01T00:00:00.000Z',
				endDate: '2024-11-01T00:00:00.000Z'
			}).map(e => e.id)
		).toEqual(['b']);
	});

	// #106 (C358): the DateRangePicker binds a date-only 'YYYY-MM-DD' (CalendarDate.toString()), and the
	// old `<= new Date(endDate)` treated that as midnight UTC → an expense ON the chosen end day was
	// EXCLUDED (off-by-one). The bounds are now LOCAL calendar days with an inclusive end. These pin a
	// date-picker-shaped range including an expense logged later in the day on the end boundary.
	describe('#106 — date-picker (YYYY-MM-DD) end boundary is inclusive of the whole day', () => {
		// An expense stored at noon-local (how dateOnlyToISO persists a date-only entry) on the end day.
		const noonOnEndDay = new Date(2024, 5, 15, 12, 0, 0).toISOString(); // 2024-06-15 noon LOCAL
		const dayList = [
			expense({ id: 'before', date: new Date(2024, 5, 14, 12, 0, 0).toISOString() }),
			expense({ id: 'onEnd', date: noonOnEndDay }),
			expense({ id: 'after', date: new Date(2024, 5, 16, 12, 0, 0).toISOString() })
		];

		test('endDate = the picker day INCLUDES an expense logged that day (was excluded pre-#106)', () => {
			const out = filterExpenses(dayList, '', { endDate: '2024-06-15' }).map(e => e.id);
			expect(out).toContain('onEnd'); // the load-bearing assertion
			expect(out).not.toContain('after');
		});

		test('a YYYY-MM-DD closed range includes both boundary days', () => {
			const out = filterExpenses(dayList, '', {
				startDate: '2024-06-14',
				endDate: '2024-06-15'
			})
				.map(e => e.id)
				.sort();
			expect(out).toEqual(['before', 'onEnd']);
		});
	});

	test('search + category compose (AND)', () => {
		const out = filterExpenses(list, 'premium', { category: 'fuel' });
		expect(out.map(e => e.id)).toEqual(['b']);
	});
});

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
