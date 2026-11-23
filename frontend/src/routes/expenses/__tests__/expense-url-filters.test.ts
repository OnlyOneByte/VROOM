import { describe, expect, test } from 'vitest';
import { expenseUrlFiltersQuery, parseExpenseUrlFilters } from '../expense-url-filters.ts';

function parse(query: string) {
	return parseExpenseUrlFilters(new URLSearchParams(query));
}

describe('parseExpenseUrlFilters', () => {
	test('reads every filter from the query string', () => {
		expect(
			parse(
				'vehicleId=v1&category=maintenance&startDate=2026-01-01&endDate=2026-01-31&tags=work,road%20trip&q=oil'
			)
		).toEqual({
			vehicleId: 'v1',
			category: 'maintenance',
			startDate: '2026-01-01',
			endDate: '2026-01-31',
			tags: ['work', 'road trip'],
			q: 'oil'
		});
	});

	test('an empty query string means no filters', () => {
		expect(parse('')).toEqual({
			vehicleId: undefined,
			category: undefined,
			startDate: undefined,
			endDate: undefined,
			tags: [],
			q: ''
		});
	});

	test.each([
		['an unknown category', 'category=groceries', { category: undefined }],
		['a date that is not a day', 'startDate=2026-01', { startDate: undefined }],
		['a day that does not exist', 'endDate=2026-02-30', { endDate: undefined }],
		['a timestamp', 'startDate=2026-01-01T00:00:00Z', { startDate: undefined }],
		[
			'a range that ends before it starts',
			'startDate=2026-02-01&endDate=2026-01-01',
			{ startDate: undefined, endDate: undefined }
		],
		['blank and repeated tags', 'tags=work,,%20,work', { tags: ['work'] }],
		['a blank vehicle', 'vehicleId=%20', { vehicleId: undefined }]
	])('ignores %s', (_label, query, expected) => {
		expect(parse(query)).toMatchObject(expected);
	});

	test('keeps a one-sided date range', () => {
		expect(parse('startDate=2026-01-01')).toMatchObject({
			startDate: '2026-01-01',
			endDate: undefined
		});
	});

	test('trims the search and caps it at the server limit', () => {
		expect(parse(`q=${encodeURIComponent(`  ${'a'.repeat(120)}  `)}`).q).toHaveLength(100);
	});
});

describe('expenseUrlFiltersQuery', () => {
	test('writes only the filters that are set', () => {
		expect(expenseUrlFiltersQuery({ vehicleId: 'v1', category: 'fuel', tags: [], q: '  ' })).toBe(
			'?vehicleId=v1&category=fuel'
		);
	});

	test('no filters is an empty query', () => {
		expect(expenseUrlFiltersQuery({ tags: [], q: '' })).toBe('');
	});

	test('round-trips through the parser', () => {
		const filters = {
			vehicleId: 'v 1',
			category: 'misc',
			startDate: '2026-03-01',
			endDate: '2026-03-31',
			tags: ['a&b', 'road trip'],
			q: '42.50'
		};
		const query = expenseUrlFiltersQuery(filters);
		expect(parseExpenseUrlFilters(new URLSearchParams(query.slice(1)))).toEqual(filters);
	});
});
