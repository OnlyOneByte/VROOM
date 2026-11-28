import { beforeEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import type { Expense, UserSettings, Vehicle } from '#lib/types/index.ts';

const nav = vi.hoisted(() => ({
	page: { url: new URL('http://localhost/expenses'), state: {} },
	replaceState: vi.fn(),
	afterNavigate: [] as Array<
		(navigation: { type: string; shallow: boolean; to: { url: URL } | null }) => void
	>
}));

vi.mock('$app/navigation', () => ({
	goto: (url: string, opts: { shallow?: boolean; replace?: boolean; state?: unknown }) => {
		if (opts.shallow && opts.replace) {
			nav.replaceState(url, opts.state);
			history.replaceState(null, '', url);
		}
		const to = { url: new URL(url, location.href) };
		for (const callback of nav.afterNavigate) {
			callback({ type: 'goto', shallow: !!opts.shallow, to });
		}
		return Promise.resolve();
	},
	afterNavigate: (callback: (typeof nav.afterNavigate)[number]) => {
		nav.afterNavigate.push(callback);
	}
}));
vi.mock('$app/state', () => ({
	get page() {
		return nav.page;
	}
}));
vi.mock('$app/paths', () => ({ resolve: (path: string) => path }));

let tableProps: Record<string, unknown> = {};
vi.mock('#lib/components/expenses/ExpensesTable.svelte', () => ({
	default: (_anchor: unknown, props: Record<string, unknown>) => {
		tableProps = props;
	}
}));
vi.mock('#lib/components/expenses/ImportFromPhotosDialog.svelte', () => ({ default: () => {} }));

const getAllExpenses = vi.fn();
const getExpenseSummary = vi.fn();
const getVehicles = vi.fn();
const getMonthlyTotals = vi.fn();
const updateExpense = vi.fn();

vi.mock('#lib/services/expense-api.ts', () => ({
	expenseApi: {
		getAllExpenses: (...args: unknown[]) => getAllExpenses(...args),
		getExpenseSummary: (...args: unknown[]) => getExpenseSummary(...args),
		getMonthlyTotals: (...args: unknown[]) => getMonthlyTotals(...args),
		updateExpense: (...args: unknown[]) => updateExpense(...args),
		downloadExpensesCsv: () => Promise.resolve()
	}
}));
vi.mock('#lib/services/vehicle-api.ts', () => ({
	vehicleApi: { getVehicles: (...args: unknown[]) => getVehicles(...args) }
}));
vi.mock('#lib/services/settings-api.ts', () => ({
	settingsApi: {
		getSettings: () =>
			Promise.resolve({
				currencyUnit: 'USD',
				unitPreferences: { distanceUnit: 'miles', volumeUnit: 'gallons_us', chargeUnit: 'kwh' }
			} as unknown as UserSettings),
		updateSettings: () => Promise.resolve({})
	}
}));

import Page from '../+page.svelte';
import { settingsStore } from '#lib/stores/settings.svelte.ts';
import { offlineExpenseQueue, onlineStatus } from '#lib/stores/offline.svelte.ts';
import { resetPendingEdits, scheduleEdit, undoEdit } from '#lib/utils/pending-edits.svelte.ts';

const VEHICLE = {
	id: 'v1',
	make: 'Toyota',
	model: 'Camry',
	year: 2020,
	nickname: 'Daily Driver',
	createdAt: '2024-01-01T00:00:00.000Z',
	updatedAt: '2024-01-01T00:00:00.000Z'
} as unknown as Vehicle;

function openAt(query: string) {
	nav.page.url = new URL(`http://localhost/expenses${query}`);
	history.replaceState(null, '', `/expenses${query}`);
	render(Page);
}

function navigateTo(query: string) {
	const url = new URL(`http://localhost/expenses${query}`);
	history.pushState(null, '', `/expenses${query}`);
	for (const callback of nav.afterNavigate) callback({ type: 'link', shallow: false, to: { url } });
}

function lastListParams(): Record<string, unknown> {
	return (getAllExpenses.mock.lastCall?.[0] ?? {}) as Record<string, unknown>;
}

beforeEach(() => {
	settingsStore.reset();
	vi.clearAllMocks();
	nav.afterNavigate = [];
	tableProps = {};
	onlineStatus.current = true;
	offlineExpenseQueue.current = [];
	getVehicles.mockResolvedValue([VEHICLE]);
	getMonthlyTotals.mockResolvedValue([{ month: '2026-01', amount: 12.5, count: 1 }]);
	getAllExpenses.mockResolvedValue({
		data: [],
		pagination: { totalCount: 0, limit: 20, offset: 0, hasMore: false }
	});
	getExpenseSummary.mockResolvedValue({
		totalAmount: 0,
		expenseCount: 0,
		recentAmount: 0,
		monthlyAverage: 0,
		categoryBreakdown: [],
		monthlyTrend: []
	});
});

describe('/expenses filters in the URL', () => {
	test('opens with the filters the URL names and asks the server for exactly those', async () => {
		openAt('?vehicleId=v1&category=maintenance&startDate=2026-01-01&endDate=2026-01-31');

		await waitFor(() => expect(getAllExpenses).toHaveBeenCalledTimes(1));
		expect(lastListParams()).toMatchObject({
			vehicleId: 'v1',
			category: 'maintenance',
			startDate: '2026-01-01',
			endDate: '2026-01-31',
			offset: 0
		});
		expect(getExpenseSummary).toHaveBeenCalledWith({ vehicleId: 'v1' });
		expect(tableProps['activeCategory']).toBe('maintenance');
		expect(tableProps['hasActiveFilters']).toBe(true);
		const summary = await screen.findByTestId('active-filter-summary');
		expect(summary).toHaveTextContent(
			'Filtered by Daily Driver · Maintenance · Jan 1, 2026 – Jan 31, 2026'
		);
		expect(screen.getByRole('button', { name: /Clear Filters/ })).toBeInTheDocument();
		expect(nav.replaceState).not.toHaveBeenCalled();
	});

	test('a list of categories from an analytics link asks the server for all of them', async () => {
		openAt('?category=fuel,maintenance&startDate=2026-10-01&endDate=2026-10-31');

		await waitFor(() => expect(getAllExpenses).toHaveBeenCalledTimes(1));
		expect(lastListParams()).toMatchObject({ category: 'fuel,maintenance' });
		await waitFor(() => expect(tableProps['activeCategory']).toBe('fuel,maintenance'));
		expect(await screen.findByTestId('active-filter-summary')).toHaveTextContent(
			'Filtered by Fuel & charging, Maintenance · Oct 1, 2026 – Oct 31, 2026'
		);
	});

	test('an unknown vehicle id shows the normal list, without an error, and drops out of the URL', async () => {
		openAt('?vehicleId=someone-elses-car&category=nope');

		await waitFor(() => expect(getAllExpenses).toHaveBeenCalledTimes(1));
		expect(lastListParams()).not.toHaveProperty('vehicleId');
		expect(lastListParams()).not.toHaveProperty('category');
		expect(getExpenseSummary).toHaveBeenCalledWith({});
		await waitFor(() => expect(nav.replaceState).toHaveBeenCalledWith('/expenses', {}));
		expect(screen.queryByText("Couldn't load expenses")).toBeNull();
		expect(screen.queryByTestId('active-filter-summary')).toBeNull();
	});

	test('changing a filter replaces the URL instead of adding a history entry', async () => {
		openAt('?category=fuel');
		await waitFor(() => expect(tableProps['onCategoryChange']).toBeTypeOf('function'));

		(tableProps['onCategoryChange'] as (category: string) => void)('maintenance');

		await waitFor(() =>
			expect(nav.replaceState).toHaveBeenLastCalledWith('/expenses?category=maintenance', {})
		);
		expect(lastListParams()).toMatchObject({ category: 'maintenance' });
	});

	test('the search term is written as q and Clear removes every filter from the URL', async () => {
		openAt('?tags=work');
		const input = await screen.findByRole('textbox', { name: 'Search expenses and vehicles' });

		await fireEvent.input(input, { target: { value: 'oil' } });
		await waitFor(() =>
			expect(nav.replaceState).toHaveBeenLastCalledWith('/expenses?tags=work&q=oil', {})
		);

		await fireEvent.click(screen.getByRole('button', { name: /Clear Filters/ }));
		await waitFor(() => expect(nav.replaceState).toHaveBeenLastCalledWith('/expenses', {}));
	});

	test('returning to the filters the page opened with still rewrites the URL', async () => {
		openAt('');
		const input = await screen.findByRole('textbox', { name: 'Search expenses and vehicles' });

		await fireEvent.input(input, { target: { value: 'oil' } });
		await waitFor(() => expect(location.search).toBe('?q=oil'));
		await fireEvent.click(screen.getByRole('button', { name: /Clear Filters/ }));

		await waitFor(() => expect(nav.replaceState).toHaveBeenLastCalledWith('/expenses', {}));
		expect(location.search).toBe('');
	});

	test('switching a filter away and back writes the URL both times', async () => {
		openAt('?category=fuel');
		await waitFor(() => expect(tableProps['onCategoryChange']).toBeTypeOf('function'));
		const setCategory = tableProps['onCategoryChange'] as (category: string) => void;

		setCategory('maintenance');
		await waitFor(() => expect(location.search).toBe('?category=maintenance'));
		setCategory('fuel');

		await waitFor(() => expect(location.search).toBe('?category=fuel'));
	});

	test('following a link to /expenses while on the page applies its filters', async () => {
		openAt('?q=oil&category=fuel');
		await screen.findByTestId('active-filter-summary');

		navigateTo('?vehicleId=v1');

		await waitFor(() => expect(getAllExpenses).toHaveBeenCalledTimes(2));
		expect(lastListParams()).toMatchObject({ vehicleId: 'v1' });
		expect(lastListParams()).not.toHaveProperty('search');
		expect(lastListParams()).not.toHaveProperty('category');
		expect(screen.getByRole('textbox', { name: 'Search expenses and vehicles' })).toHaveValue('');
	});

	test('a search longer than the URL keeps is not cut back in the box after the URL write', async () => {
		openAt('');
		const input = await screen.findByRole('textbox', { name: 'Search expenses and vehicles' });
		const long = 'a'.repeat(120);

		await fireEvent.input(input, { target: { value: long } });
		await waitFor(() => expect(location.search).toBe(`?q=${'a'.repeat(100)}`));
		await new Promise(resolve => setTimeout(resolve, 400));

		expect(input).toHaveValue(long);
	});

	test('a link followed while the page is still loading is applied once the vehicles arrive', async () => {
		let resolveVehicles: (vehicles: Vehicle[]) => void = () => {};
		getVehicles.mockReturnValue(new Promise(resolve => (resolveVehicles = resolve)));
		openAt('?category=fuel');

		navigateTo('?vehicleId=v1');
		resolveVehicles([VEHICLE]);

		await waitFor(() => expect(lastListParams()).toMatchObject({ vehicleId: 'v1' }));
		expect(lastListParams()).not.toHaveProperty('category');
		expect(await screen.findByTestId('active-filter-summary')).toHaveTextContent(
			'Filtered by Daily Driver'
		);
	});

	test('month totals are asked for with the same filters, and again when the category changes', async () => {
		openAt('?vehicleId=v1&category=fuel&startDate=2026-01-01&endDate=2026-01-31&q=arco');

		await waitFor(() => expect(getMonthlyTotals).toHaveBeenCalledTimes(1));
		expect(getMonthlyTotals.mock.lastCall?.[0]).toEqual({
			vehicleId: 'v1',
			category: 'fuel',
			startDate: '2026-01-01',
			endDate: '2026-01-31',
			search: 'arco'
		});
		await waitFor(() => expect(tableProps['monthTotals']).toEqual(new Map([['2026-01', 12.5]])));

		(tableProps['onCategoryChange'] as (category: string) => void)('maintenance');

		await waitFor(() => expect(getMonthlyTotals).toHaveBeenCalledTimes(2));
		expect(getMonthlyTotals.mock.lastCall?.[0]).toMatchObject({ category: 'maintenance' });
	});
});

describe('/expenses after an Undo of a move off the filtered car', () => {
	const row = (id: string, day: number) =>
		({
			id,
			vehicleId: 'v1',
			userId: 'u1',
			category: 'fuel',
			amount: 10,
			date: `2026-01-${String(day).padStart(2, '0')}T12:00:00.000Z`,
			tags: [],
			createdAt: '2026-01-01T00:00:00.000Z',
			updatedAt: '2026-01-01T00:00:00.000Z'
		}) as unknown as Expense;
	const listedIds = () => ((tableProps['expenses'] ?? []) as Expense[]).map(expense => expense.id);

	test('a list answered while the Undo was saving keeps an expense that sorts onto a later page off page 1', async () => {
		const moved = row('e1', 2);
		const newer = Array.from({ length: 20 }, (_, i) => row(`n${i}`, 25 - i));
		updateExpense
			.mockResolvedValueOnce({ ...moved, vehicleId: 'v2', updatedAt: '2026-01-01T00:00:01.000Z' })
			.mockReturnValueOnce(new Promise(() => {}));
		getAllExpenses.mockResolvedValue({
			data: newer.slice(0, 19),
			pagination: { totalCount: 19, limit: 20, offset: 0, hasMore: false }
		});
		try {
			scheduleEdit(moved, { ...moved, vehicleId: 'v2' }, {
				vehicleId: 'v2',
				category: 'fuel',
				amount: 10
			} as never);
			await new Promise(resolve => setTimeout(resolve, 0));
			openAt('?vehicleId=v1');
			await waitFor(() => expect(listedIds()).toHaveLength(19));

			undoEdit('e1');
			await waitFor(() => expect(listedIds()[0]).toBe('e1'));

			getAllExpenses.mockResolvedValue({
				data: newer,
				pagination: { totalCount: 21, limit: 20, offset: 0, hasMore: true }
			});
			(tableProps['onSortChange'] as (by: string, dir: string) => void)('date', 'desc');
			await waitFor(() => expect(listedIds()).toEqual(newer.map(expense => expense.id)));
		} finally {
			resetPendingEdits();
		}
	});
});

describe('/expenses month totals with an edit in flight', () => {
	const before = {
		id: 'e1',
		vehicleId: 'v1',
		userId: 'u1',
		category: 'fuel',
		amount: 10,
		date: '2026-01-15T12:00:00.000Z',
		tags: [],
		createdAt: '2026-01-01T00:00:00.000Z',
		updatedAt: '2026-01-01T00:00:00.000Z'
	} as unknown as Expense;
	const after = { ...before, amount: 25 };
	const saved = { ...after, updatedAt: '2026-01-01T00:00:01.000Z' };
	const listed = (row: Expense) => ({
		data: [row],
		pagination: { totalCount: 1, limit: 20, offset: 0, hasMore: false }
	});
	const january = () => (tableProps['monthTotals'] as ReadonlyMap<string, number>).get('2026-01');

	test('month totals loaded before the save keep the edit once a re-sorted list holds the saved row', async () => {
		getAllExpenses.mockResolvedValue(listed(before));
		getMonthlyTotals.mockResolvedValue([{ month: '2026-01', amount: 30, count: 2 }]);
		updateExpense.mockResolvedValueOnce(saved);
		try {
			openAt('');
			await waitFor(() => expect(january()).toBe(30));

			scheduleEdit(before, after, { amount: 25 } as never);
			await waitFor(() => expect(january()).toBe(45));

			getAllExpenses.mockResolvedValue(listed(saved));
			(tableProps['onSortChange'] as (by: string, dir: string) => void)('amount', 'desc');
			await waitFor(() => expect(getAllExpenses).toHaveBeenCalledTimes(2));
			await new Promise(resolve => setTimeout(resolve, 0));

			expect(getMonthlyTotals).toHaveBeenCalledTimes(1);
			expect(january()).toBe(45);
		} finally {
			resetPendingEdits();
		}
	});

	test('month totals reloaded after the save are not changed again while the list still holds the old row', async () => {
		getAllExpenses.mockResolvedValue(listed(before));
		getMonthlyTotals.mockResolvedValue([{ month: '2026-01', amount: 30, count: 2 }]);
		updateExpense.mockResolvedValueOnce(saved);
		try {
			openAt('');
			await waitFor(() => expect(january()).toBe(30));
			scheduleEdit(before, after, { amount: 25 } as never);
			await waitFor(() => expect(updateExpense).toHaveBeenCalledTimes(1));
			await new Promise(resolve => setTimeout(resolve, 0));

			getAllExpenses.mockRejectedValueOnce(new Error('Network down'));
			getMonthlyTotals.mockResolvedValue([{ month: '2026-01', amount: 45, count: 2 }]);
			(tableProps['onCategoryChange'] as (category: string) => void)('');
			await waitFor(() => expect(getMonthlyTotals).toHaveBeenCalledTimes(2));
			await new Promise(resolve => setTimeout(resolve, 0));

			expect(january()).toBe(45);
		} finally {
			resetPendingEdits();
		}
	});

	test('with a search the page cannot check, an edited row paged away is never counted twice', async () => {
		const other = { ...before, id: 'e2', amount: 20 } as Expense;
		getAllExpenses.mockResolvedValue(listed(before));
		getMonthlyTotals.mockResolvedValue([{ month: '2026-01', amount: 30, count: 2 }]);
		updateExpense.mockResolvedValueOnce(saved);
		try {
			openAt('?q=camry');
			await waitFor(() => expect(january()).toBe(30));
			scheduleEdit(before, after, { amount: 25 } as never);
			await waitFor(() => expect(january()).toBe(45));

			getAllExpenses.mockResolvedValue({
				data: [other],
				pagination: { totalCount: 21, limit: 20, offset: 20, hasMore: false }
			});
			(tableProps['onPageChange'] as (offset: number) => void)(20);
			await waitFor(() => expect(getAllExpenses).toHaveBeenCalledTimes(2));
			await new Promise(resolve => setTimeout(resolve, 0));

			expect(january()).toBe(30);
		} finally {
			resetPendingEdits();
		}
	});
});

describe('/expenses month totals after an Undo brings an expense back into a searched view', () => {
	const moved = {
		id: 'e1',
		vehicleId: 'v1',
		userId: 'u1',
		category: 'fuel',
		amount: 10,
		date: '2026-01-15T12:00:00.000Z',
		description: 'Arco',
		tags: [],
		createdAt: '2026-01-01T00:00:00.000Z',
		updatedAt: '2026-01-01T00:00:00.000Z'
	} as unknown as Expense;
	const january = () => (tableProps['monthTotals'] as ReadonlyMap<string, number>).get('2026-01');

	async function undoWhileSearching(search: string): Promise<number | undefined> {
		updateExpense
			.mockResolvedValueOnce({ ...moved, vehicleId: 'v2', updatedAt: '2026-01-01T00:00:01.000Z' })
			.mockReturnValueOnce(new Promise(() => {}));
		getMonthlyTotals.mockResolvedValue([{ month: '2026-01', amount: 30, count: 2 }]);
		try {
			scheduleEdit(moved, { ...moved, vehicleId: 'v2' }, { vehicleId: 'v2' } as never);
			await waitFor(() => expect(updateExpense).toHaveBeenCalledTimes(1));
			await new Promise(resolve => setTimeout(resolve, 0));
			openAt(`?vehicleId=v1&q=${search}`);
			await waitFor(() => expect(january()).toBe(30));

			undoEdit('e1');
			await waitFor(() => expect(updateExpense).toHaveBeenCalledTimes(2));
			await new Promise(resolve => setTimeout(resolve, 0));
			return january();
		} finally {
			resetPendingEdits();
		}
	}

	test('an expense that does not match the search is not added back to the month totals', async () => {
		expect(await undoWhileSearching('shell')).toBe(30);
	});

	test('an expense that matches the search is added back to the month totals', async () => {
		expect(await undoWhileSearching('arco')).toBe(40);
	});
});
