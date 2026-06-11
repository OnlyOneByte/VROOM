/**
 * Unit tests for compareExpenseRows — the stable expenses-table comparator (bug #4).
 *
 * The defect: both ExpensesTable sort sites compared only by date/amount and returned 0
 * on a tie, so equal-key rows fell back to JS engine ordering / the standalone-then-group
 * array-build order — a visible reshuffle vs. the server on pagination/refresh.
 *
 * The fix mirrors the server's `orderBy(dir(sortColumn), dir(id))`
 * (backend expenses/repository.ts:287): an id tiebreaker that inherits the SAME direction
 * as the primary sort. The load-bearing assertion is the DIRECTION of the tiebreak — a
 * naive `|| id.localeCompare()` applied after the asc/desc flip would always break
 * ascending and diverge from the server on a desc sort.
 */

import { describe, expect, test } from 'vitest';
import { compareExpenseRows, type SortableRow } from '../expense-helpers';

const row = (id: string, over: Partial<SortableRow> = {}): SortableRow => ({
	id,
	date: over.date ?? '2024-06-15T00:00:00.000Z',
	amount: over.amount ?? 100
});

/** Sort a copy via the comparator and return the resulting id order. */
function order(
	rows: SortableRow[],
	by: 'date' | 'amount',
	dir: 'asc' | 'desc'
): string[] {
	return [...rows].sort((a, b) => compareExpenseRows(a, b, by, dir)).map((r) => r.id);
}

describe('compareExpenseRows — primary sort', () => {
	test('date desc orders newest first', () => {
		const rows = [
			row('a', { date: '2024-01-01T00:00:00.000Z' }),
			row('b', { date: '2024-12-31T00:00:00.000Z' }),
			row('c', { date: '2024-06-15T00:00:00.000Z' })
		];
		expect(order(rows, 'date', 'desc')).toEqual(['b', 'c', 'a']);
	});

	test('amount asc orders smallest first', () => {
		const rows = [row('a', { amount: 300 }), row('b', { amount: 100 }), row('c', { amount: 200 })];
		expect(order(rows, 'amount', 'asc')).toEqual(['b', 'c', 'a']);
	});
});

describe('compareExpenseRows — id tiebreaker inherits the sort direction (the bug #4 fix)', () => {
	const sameDate = '2024-06-15T00:00:00.000Z';
	// All three share the same date → the date comparison is 0 → id decides.
	const tied = [row('id-a', { date: sameDate }), row('id-b', { date: sameDate }), row('id-c', { date: sameDate })];

	test('date desc → ties break by id DESC (matches the server)', () => {
		expect(order(tied, 'date', 'desc')).toEqual(['id-c', 'id-b', 'id-a']);
	});

	test('date asc → ties break by id ASC', () => {
		expect(order(tied, 'date', 'asc')).toEqual(['id-a', 'id-b', 'id-c']);
	});

	test('amount desc → equal amounts break by id DESC', () => {
		const eq = [row('x1', { amount: 50 }), row('x2', { amount: 50 }), row('x3', { amount: 50 })];
		expect(order(eq, 'amount', 'desc')).toEqual(['x3', 'x2', 'x1']);
	});

	test('amount asc → equal amounts break by id ASC', () => {
		const eq = [row('x3', { amount: 50 }), row('x1', { amount: 50 }), row('x2', { amount: 50 })];
		expect(order(eq, 'amount', 'asc')).toEqual(['x1', 'x2', 'x3']);
	});
});

describe('compareExpenseRows — determinism (input order independence)', () => {
	const sameDate = '2024-06-15T00:00:00.000Z';

	test('two different input orderings of tied rows produce the SAME output (no reshuffle)', () => {
		const forward = [row('a', { date: sameDate }), row('b', { date: sameDate }), row('c', { date: sameDate })];
		const reversed = [row('c', { date: sameDate }), row('b', { date: sameDate }), row('a', { date: sameDate })];
		// This is the exact bug #4 invariant: regardless of how grouping concatenated the
		// rows (standalone-then-group), the sorted order is fixed.
		expect(order(forward, 'date', 'desc')).toEqual(order(reversed, 'date', 'desc'));
	});

	test('mixed: primary sort wins, id only decides within an equal-key cluster', () => {
		const rows = [
			row('b', { date: '2024-06-15T00:00:00.000Z' }),
			row('a', { date: '2024-06-15T00:00:00.000Z' }),
			row('z', { date: '2024-12-31T00:00:00.000Z' })
		];
		// desc: the Dec row first, then the two June rows tie-broken id-desc (b before a).
		expect(order(rows, 'date', 'desc')).toEqual(['z', 'b', 'a']);
	});
});
