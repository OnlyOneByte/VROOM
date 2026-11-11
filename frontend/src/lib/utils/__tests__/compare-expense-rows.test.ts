import { describe, expect, test } from 'vitest';
import { compareExpenseRows, type SortableRow } from '../expense-helpers';

const row = (id: string, over: Partial<SortableRow> = {}): SortableRow => ({
	id,
	date: over.date ?? '2024-06-15T00:00:00.000Z',
	amount: over.amount ?? 100
});

function order(rows: SortableRow[], by: 'date' | 'amount', dir: 'asc' | 'desc'): string[] {
	return [...rows].sort((a, b) => compareExpenseRows(a, b, by, dir)).map(r => r.id);
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

describe('compareExpenseRows — id tiebreaker inherits the sort direction', () => {
	const sameDate = '2024-06-15T00:00:00.000Z';
	const tied = [
		row('id-a', { date: sameDate }),
		row('id-b', { date: sameDate }),
		row('id-c', { date: sameDate })
	];

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
		const forward = [
			row('a', { date: sameDate }),
			row('b', { date: sameDate }),
			row('c', { date: sameDate })
		];
		const reversed = [
			row('c', { date: sameDate }),
			row('b', { date: sameDate }),
			row('a', { date: sameDate })
		];
		expect(order(forward, 'date', 'desc')).toEqual(order(reversed, 'date', 'desc'));
	});

	test('mixed: primary sort wins, id only decides within an equal-key cluster', () => {
		const rows = [
			row('b', { date: '2024-06-15T00:00:00.000Z' }),
			row('a', { date: '2024-06-15T00:00:00.000Z' }),
			row('z', { date: '2024-12-31T00:00:00.000Z' })
		];
		expect(order(rows, 'date', 'desc')).toEqual(['z', 'b', 'a']);
	});
});
