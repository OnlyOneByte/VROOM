import { describe, expect, test } from 'vitest';
import type { Expense, Vehicle } from '#lib/types/index.ts';
import {
	buildDisplayRows,
	rowKey,
	visibleExpenses,
	type GroupRow,
	type VisibleExpenseOptions
} from '../expense-table-rows';

function expense(overrides: Partial<Expense> & Pick<Expense, 'id'>): Expense {
	return {
		vehicleId: 'v1',
		userId: 'u1',
		tags: [],
		category: 'fuel',
		amount: 10,
		date: '2024-03-15T12:00:00.000Z',
		createdAt: '2024-03-15T12:00:00.000Z',
		updatedAt: '2024-03-15T12:00:00.000Z',
		...overrides
	} as Expense;
}

const VEHICLES = new Map<string, Vehicle>([
	['v1', { id: 'v1', make: 'Toyota', model: 'Camry', nickname: 'Daily' } as Vehicle],
	['v2', { id: 'v2', make: 'Ford', model: 'F-150', nickname: 'Truck' } as Vehicle]
]);

const VIEW: VisibleExpenseOptions = {
	categoryFilter: '',
	filterByCategory: true,
	sortLocally: true,
	sortBy: 'date',
	sortOrder: 'desc'
};

describe('visibleExpenses', () => {
	const list = [
		expense({ id: 'a', category: 'fuel', amount: 5, date: '2024-01-01T00:00:00.000Z' }),
		expense({ id: 'b', category: 'maintenance', amount: 50, date: '2024-03-01T00:00:00.000Z' }),
		expense({ id: 'c', category: 'fuel', amount: 20, date: '2024-02-01T00:00:00.000Z' })
	];

	test('narrows to the active category when the filter is applied locally', () => {
		const ids = visibleExpenses(list, { ...VIEW, categoryFilter: 'fuel' }).map(e => e.id);

		expect(ids).toEqual(['c', 'a']);
	});

	test('keeps every row when no category is selected', () => {
		expect(visibleExpenses(list, VIEW)).toHaveLength(3);
	});

	test('leaves the category alone when the parent already applied it', () => {
		const ids = visibleExpenses(list, {
			...VIEW,
			categoryFilter: 'fuel',
			filterByCategory: false
		}).map(e => e.id);

		expect(ids).toEqual(['b', 'c', 'a']);
	});

	test('sorts by the active field and direction when sorting locally', () => {
		const ids = visibleExpenses(list, { ...VIEW, sortBy: 'amount', sortOrder: 'asc' }).map(
			e => e.id
		);

		expect(ids).toEqual(['a', 'c', 'b']);
	});

	test('preserves the server order when sorting is left to the parent', () => {
		const ids = visibleExpenses(list, { ...VIEW, sortLocally: false, sortBy: 'amount' }).map(
			e => e.id
		);

		expect(ids).toEqual(['a', 'b', 'c']);
	});

	test('never reorders the array it was given', () => {
		const snapshot = list.map(e => e.id);

		visibleExpenses(list, { ...VIEW, sortBy: 'amount', sortOrder: 'asc' });

		expect(list.map(e => e.id)).toEqual(snapshot);
	});
});

describe('buildDisplayRows', () => {
	test('folds split siblings into one group row and keeps standalone expenses as they are', () => {
		const rows = buildDisplayRows(
			[
				expense({ id: 's1', date: '2024-03-20T00:00:00.000Z' }),
				expense({
					id: 'g1',
					groupId: 'g',
					vehicleId: 'v1',
					amount: 60,
					date: '2024-03-10T00:00:00.000Z'
				}),
				expense({
					id: 'g2',
					groupId: 'g',
					vehicleId: 'v2',
					amount: 40,
					date: '2024-03-10T00:00:00.000Z'
				})
			],
			VEHICLES,
			{ sortBy: 'date', sortOrder: 'desc' }
		);

		expect(rows.map(r => r.type)).toEqual(['standalone', 'group']);
		const group = rows[1] as GroupRow;
		expect(group.totalAmount).toBe(100);
		expect(group.children.map(c => c.id)).toEqual(['g1', 'g2']);
		expect(group.vehicleNames).toEqual(['Daily', 'Truck']);
	});

	test('lists each vehicle name once, and skips children whose vehicle is unknown', () => {
		const rows = buildDisplayRows(
			[
				expense({ id: 'g1', groupId: 'g', vehicleId: 'v1' }),
				expense({ id: 'g2', groupId: 'g', vehicleId: 'v1' }),
				expense({ id: 'g3', groupId: 'g', vehicleId: 'gone' })
			],
			VEHICLES,
			{ sortBy: 'date', sortOrder: 'desc' }
		);

		expect((rows[0] as GroupRow).vehicleNames).toEqual(['Daily']);
	});

	test('rounds the group total to cents', () => {
		const rows = buildDisplayRows(
			[
				expense({ id: 'g1', groupId: 'g', amount: 0.1 }),
				expense({ id: 'g2', groupId: 'g', amount: 0.2 })
			],
			VEHICLES,
			{ sortBy: 'amount', sortOrder: 'asc' }
		);

		expect((rows[0] as GroupRow).totalAmount).toBe(0.3);
	});

	test('ranks a group by its combined total, not by one portion, when sorting by amount', () => {
		const list = [
			expense({ id: 'single', amount: 50 }),
			expense({ id: 'g1', groupId: 'g', amount: 30 }),
			expense({ id: 'g2', groupId: 'g', amount: 30 })
		];

		expect(
			buildDisplayRows(list, VEHICLES, { sortBy: 'amount', sortOrder: 'desc' }).map(rowKey)
		).toEqual(['g', 'single']);
		expect(
			buildDisplayRows(list, VEHICLES, { sortBy: 'amount', sortOrder: 'asc' }).map(rowKey)
		).toEqual(['single', 'g']);
	});

	test('takes the group category, date, description and tags from its first child', () => {
		const rows = buildDisplayRows(
			[
				expense({
					id: 'g1',
					groupId: 'g',
					category: 'financial',
					description: 'Policy',
					tags: ['insurance'],
					date: '2024-02-02T00:00:00.000Z'
				}),
				expense({ id: 'g2', groupId: 'g', category: 'misc', description: 'ignored' })
			],
			VEHICLES,
			{ sortBy: 'date', sortOrder: 'desc' }
		);

		expect(rows[0]).toMatchObject({
			type: 'group',
			category: 'financial',
			description: 'Policy',
			tags: ['insurance'],
			date: '2024-02-02T00:00:00.000Z'
		});
	});

	test('gives a group with no tags an empty tag list', () => {
		const rows = buildDisplayRows(
			[expense({ id: 'g1', groupId: 'g', tags: undefined as unknown as string[] })],
			VEHICLES,
			{
				sortBy: 'date',
				sortOrder: 'desc'
			}
		);

		expect((rows[0] as GroupRow).tags).toEqual([]);
	});
});

describe('rowKey', () => {
	test('keys a standalone row by its expense id and a group row by its group id', () => {
		const rows = buildDisplayRows(
			[expense({ id: 'solo' }), expense({ id: 'g1', groupId: 'grp' })],
			VEHICLES,
			{ sortBy: 'date', sortOrder: 'desc' }
		);

		expect(rows.map(rowKey).sort()).toEqual(['grp', 'solo']);
	});
});
