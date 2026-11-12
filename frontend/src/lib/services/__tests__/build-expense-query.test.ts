import { describe, expect, test } from 'vitest';
import { buildExpenseQuery } from '../expense-api';

describe('buildExpenseQuery', () => {
	test('empty params → empty string', () => {
		expect(buildExpenseQuery()).toBe('');
		expect(buildExpenseQuery({})).toBe('');
	});

	test('vehicleId is set from the second arg, with the leading "?"', () => {
		expect(buildExpenseQuery({}, 'veh-1')).toBe('?vehicleId=veh-1');
	});

	test('maps each scalar param to its key', () => {
		const qs = buildExpenseQuery({
			limit: 20,
			offset: 40,
			category: 'fuel',
			startDate: '2024-01-01',
			endDate: '2024-12-31',
			period: 'year'
		});
		const map = new URLSearchParams(qs);
		expect(map.get('limit')).toBe('20');
		expect(map.get('offset')).toBe('40');
		expect(map.get('category')).toBe('fuel');
		expect(map.get('startDate')).toBe('2024-01-01');
		expect(map.get('endDate')).toBe('2024-12-31');
		expect(map.get('period')).toBe('year');
	});

	test('search is trimmed', () => {
		expect(new URLSearchParams(buildExpenseQuery({ search: '  shell  ' })).get('search')).toBe(
			'shell'
		);
	});

	test('whitespace-only search is dropped (not sent as empty)', () => {
		expect(buildExpenseQuery({ search: '   ' })).toBe('');
	});

	test('tags become ONE comma-joined tags= param, preserving order', () => {
		const map = new URLSearchParams(buildExpenseQuery({ tags: ['tolls', 'highway'] }));
		expect(map.getAll('tags')).toEqual(['tolls,highway']);
	});

	test('offset 0 and limit 0 are omitted (falsy guard — 0 = default, not a filter)', () => {
		expect(buildExpenseQuery({ offset: 0, limit: 0 })).toBe('');
	});

	test('empty tags array adds nothing', () => {
		expect(buildExpenseQuery({ tags: [] })).toBe('');
	});

	test('composes vehicleId + filters + tags together', () => {
		const qs = buildExpenseQuery(
			{ category: 'maintenance', tags: ['oil', 'brakes'], limit: 10 },
			'veh-9'
		);
		const map = new URLSearchParams(qs);
		expect(map.get('vehicleId')).toBe('veh-9');
		expect(map.get('category')).toBe('maintenance');
		expect(map.get('limit')).toBe('10');
		expect(map.getAll('tags')).toEqual(['oil,brakes']);
	});

	test('maps sortBy / sortDir when provided', () => {
		const map = new URLSearchParams(buildExpenseQuery({ sortBy: 'amount', sortDir: 'asc' }));
		expect(map.get('sortBy')).toBe('amount');
		expect(map.get('sortDir')).toBe('asc');
	});

	test('omits sort params when not set (default date-desc stays a bare query)', () => {
		expect(buildExpenseQuery({ limit: 20, offset: 0 })).toBe('?limit=20');
	});
});
