import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { UNEXPECTED_FAILURE_MESSAGE } from '#lib/utils/error-handling.ts';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import type { Expense, ExpenseSummary, UserSettings, Vehicle } from '#lib/types/index.ts';
import type { OfflineExpense } from '#lib/utils/offline-storage.ts';
import { appStore } from '#lib/stores/app.svelte.ts';
import { offlineExpenseQueue } from '#lib/stores/offline.svelte.ts';

vi.mock('$app/navigation', () => ({ goto: vi.fn(() => Promise.resolve()), replaceState: vi.fn() }));
vi.mock('$app/paths', () => ({ resolve: (path: string) => path }));

const captured = vi.hoisted(() => ({
	table: {} as Record<string, unknown>,
	csvDialog: {} as Record<string, unknown>,
	photosDialog: {} as Record<string, unknown>,
	offlineCards: {} as Record<string, unknown>
}));
vi.mock('#lib/components/expenses/ExpensesTable.svelte', () => ({
	default: (_anchor: unknown, props: Record<string, unknown>) => {
		captured.table = props;
	}
}));
vi.mock('#lib/components/expenses/ImportExpensesDialog.svelte', () => ({
	default: (_anchor: unknown, props: Record<string, unknown>) => {
		captured.csvDialog = props;
	}
}));
vi.mock('#lib/components/expenses/ImportFromPhotosDialog.svelte', () => ({
	default: (_anchor: unknown, props: Record<string, unknown>) => {
		captured.photosDialog = props;
	}
}));
vi.mock('#lib/components/expenses/OfflineExpenseCards.svelte', () => ({
	default: (_anchor: unknown, props: Record<string, unknown>) => {
		captured.offlineCards = props;
	}
}));

const { getAllExpenses, getExpenseSummary, downloadExpensesCsv, getVehicles } = vi.hoisted(() => ({
	getAllExpenses: vi.fn(),
	getExpenseSummary: vi.fn<(params: { vehicleId?: string }) => Promise<ExpenseSummary>>(),
	downloadExpensesCsv: vi.fn<(params: Record<string, unknown>) => Promise<void>>(),
	getVehicles: vi.fn<() => Promise<Vehicle[]>>()
}));
vi.mock('#lib/services/expense-api.ts', () => ({
	expenseApi: {
		getAllExpenses: (...args: unknown[]) => getAllExpenses(...args),
		getExpenseSummary: (params: { vehicleId?: string }) => getExpenseSummary(params),
		downloadExpensesCsv: (params: Record<string, unknown>) => downloadExpensesCsv(params)
	}
}));
vi.mock('#lib/services/vehicle-api.ts', () => ({
	vehicleApi: { getVehicles: () => getVehicles() }
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

const Page = (await import('../+page.svelte')).default;

const CAMRY: Vehicle = {
	id: 'v1',
	make: 'Toyota',
	model: 'Camry',
	year: 2020,
	vehicleType: 'gas',
	trackFuel: true,
	trackCharging: false,
	nickname: 'Daily Driver',
	createdAt: '2024-01-01T00:00:00.000Z',
	updatedAt: '2024-01-01T00:00:00.000Z'
};
const LEAF: Vehicle = {
	...CAMRY,
	id: 'v2',
	make: 'Nissan',
	model: 'Leaf',
	nickname: undefined,
	vehicleType: 'electric'
};

const ROWS: Expense[] = [
	{
		id: 'e1',
		vehicleId: 'v1',
		userId: 'u1',
		category: 'fuel',
		amount: 45.5,
		date: new Date(2026, 4, 3, 12).toISOString(),
		tags: ['commute', 'roadtrip'],
		createdAt: '2026-05-03T00:00:00.000Z',
		updatedAt: '2026-05-03T00:00:00.000Z'
	}
];

const SUMMARY: ExpenseSummary = {
	totalAmount: 45.5,
	expenseCount: 1,
	monthlyAverage: 45.5,
	recentAmount: 45.5,
	categoryBreakdown: [],
	monthlyTrend: []
};

function pageOf(data: Expense[], totalCount = data.length) {
	return {
		data,
		pagination: { totalCount, limit: 20, offset: 0, hasMore: false }
	};
}

function lastListParams(): Record<string, unknown> {
	return (getAllExpenses.mock.calls.at(-1)?.[0] ?? {}) as Record<string, unknown>;
}

function notificationMessages(): string[] {
	return appStore.notifications.map(n => n.message);
}

function offlineExpense(id: string, overrides: Partial<OfflineExpense>): OfflineExpense {
	return {
		id,
		vehicleId: 'v1',
		tags: [],
		category: 'misc',
		amount: 5,
		date: '2026-05-03',
		timestamp: 1,
		synced: false,
		...overrides
	};
}

async function mountLoaded() {
	const result = render(Page);
	await screen.findByRole('heading', { name: 'All Expenses' });
	await waitFor(() => expect(captured.table['expenses']).toBeDefined());
	return result;
}

async function chooseVehicle(name: string) {
	const trigger = screen.getByRole('combobox', { name: 'Vehicle filter' });
	await fireEvent.pointerDown(trigger, { button: 0, pointerType: 'mouse' });
	await fireEvent.pointerUp(trigger, { button: 0, pointerType: 'mouse' });
	const option = await screen.findByRole('option', { name });
	await fireEvent.pointerUp(option, { button: 0, pointerType: 'mouse' });
	await fireEvent.click(option);
}

async function addTagFilter(tag: string) {
	const input = screen.getByRole('combobox', { name: 'Search tags' });
	await fireEvent.input(input, { target: { value: tag } });
	await fireEvent.keyDown(input, { key: 'Enter' });
}

function callTable<T extends unknown[]>(name: string, ...args: T): unknown {
	return (captured.table[name] as (...a: T) => unknown)(...args);
}

beforeEach(() => {
	vi.clearAllMocks();
	captured.table = {};
	captured.csvDialog = {};
	captured.photosDialog = {};
	captured.offlineCards = {};
	appStore.clearNotifications();
	offlineExpenseQueue.current = [];
	getVehicles.mockResolvedValue([CAMRY, LEAF]);
	getAllExpenses.mockResolvedValue(pageOf(ROWS));
	getExpenseSummary.mockResolvedValue(SUMMARY);
	downloadExpensesCsv.mockResolvedValue();
});

afterEach(() => {
	offlineExpenseQueue.current = [];
});

const SEARCH_DEBOUNCE_WAIT = { timeout: 4000 };

describe('/expenses with no vehicles', () => {
	test('shows only the Add Vehicle empty state: no filters, overview, list or Add Expense', async () => {
		getVehicles.mockResolvedValue([]);
		getAllExpenses.mockResolvedValue(pageOf([], 0));
		getExpenseSummary.mockResolvedValue({ ...SUMMARY, totalAmount: 0, expenseCount: 0 });
		render(Page);

		await screen.findByRole('heading', { name: 'Add a vehicle first' });
		expect(screen.getByRole('link', { name: 'Add Vehicle' }).getAttribute('href')).toBe(
			'/vehicles/new'
		);
		expect(screen.queryByRole('textbox', { name: 'Search expenses and vehicles' })).toBeNull();
		expect(screen.queryByText('Search & Filters')).toBeNull();
		expect(screen.queryByText('Expense Overview')).toBeNull();
		expect(captured.table['expenses']).toBeUndefined();
		expect(screen.queryByRole('link', { name: /add expense/i })).toBeNull();
	});

	test('expenses left on a deleted vehicle still list normally', async () => {
		getVehicles.mockResolvedValue([]);
		await mountLoaded();
		expect(screen.queryByRole('heading', { name: 'Add a vehicle first' })).toBeNull();
	});

	test('a search with no matches over those expenses keeps the list and its filters', async () => {
		getVehicles.mockResolvedValue([]);
		await mountLoaded();
		getAllExpenses.mockResolvedValue(pageOf([], 0));
		await fireEvent.input(screen.getByRole('textbox', { name: 'Search expenses and vehicles' }), {
			target: { value: 'nothing matches' }
		});
		await waitFor(() => expect(lastListParams()).toMatchObject({ search: 'nothing matches' }));

		expect(screen.queryByRole('heading', { name: 'Add a vehicle first' })).toBeNull();
		expect(screen.getByRole('textbox', { name: 'Search expenses and vehicles' })).toBeTruthy();
	});
});

describe('/expenses first screen', () => {
	test('the count lives in the page description, with no repeated Expenses card header', async () => {
		await mountLoaded();
		expect(screen.getByText('1 expense across 2 vehicles')).toBeInTheDocument();
		expect(screen.queryByText(/^Expenses \(\d+\)$/)).toBeNull();
		expect(screen.queryByText('All recorded expenses')).toBeNull();
		const list = screen.getByRole('region', { name: 'Expenses' });
		expect(list).toHaveAttribute('tabindex', '-1');
	});

	test('the count uses a thousands separator and singular forms', async () => {
		getVehicles.mockResolvedValue([CAMRY]);
		getAllExpenses.mockResolvedValue(pageOf(ROWS.slice(0, 1), 10000));
		await mountLoaded();
		expect(screen.getByText('10,000 expenses across 1 vehicle')).toBeInTheDocument();
	});

	test('with expenses but no vehicles of your own, the count names no vehicles', async () => {
		getVehicles.mockResolvedValue([]);
		getExpenseSummary.mockResolvedValue({ ...SUMMARY, expenseCount: 1 });
		await mountLoaded();
		expect(screen.getByText('1 expense')).toBeInTheDocument();
		expect(screen.queryByText(/across 0 vehicles/)).toBeNull();
	});

	test('while the filtered list is in flight, the count keeps the wording of the total it shows', async () => {
		await mountLoaded();
		let release = () => {};
		getAllExpenses.mockImplementation(
			() =>
				new Promise(resolve => {
					release = () => resolve(pageOf(ROWS.slice(0, 1), 1));
				})
		);
		const calls = getAllExpenses.mock.calls.length;
		await fireEvent.input(screen.getByRole('textbox', { name: 'Search expenses and vehicles' }), {
			target: { value: 'shell' }
		});
		await waitFor(
			() => expect(getAllExpenses.mock.calls.length).toBe(calls + 1),
			SEARCH_DEBOUNCE_WAIT
		);
		expect(screen.getByText('1 expense across 2 vehicles')).toBeInTheDocument();
		expect(screen.queryByText(/match(es)? your filters$/)).toBeNull();

		release();
		expect(await screen.findByText('1 expense matches your filters')).toBeInTheDocument();
	});

	test('while Clear Filters reloads, the table keeps the filter state of the rows it shows', async () => {
		await mountLoaded();
		getAllExpenses.mockResolvedValue(pageOf([], 0));
		await fireEvent.input(screen.getByRole('textbox', { name: 'Search expenses and vehicles' }), {
			target: { value: 'nothing' }
		});
		await waitFor(
			() => expect(captured.table['hasActiveFilters']).toBe(true),
			SEARCH_DEBOUNCE_WAIT
		);

		let release = () => {};
		getAllExpenses.mockImplementation(
			() =>
				new Promise(resolve => {
					release = () => resolve(pageOf(ROWS));
				})
		);
		await fireEvent.click(screen.getByRole('button', { name: 'Clear Filters' }));
		expect(captured.table['hasActiveFilters']).toBe(true);
		expect(screen.getByText('0 expenses match your filters')).toBeInTheDocument();

		release();
		await waitFor(() => expect(captured.table['hasActiveFilters']).toBe(false));
		expect(screen.getByText('1 expense across 2 vehicles')).toBeInTheDocument();
	});

	test('a search of only spaces is not a filter', async () => {
		await mountLoaded();
		const calls = getAllExpenses.mock.calls.length;
		await fireEvent.input(screen.getByRole('textbox', { name: 'Search expenses and vehicles' }), {
			target: { value: '   ' }
		});
		await waitFor(
			() => expect(getAllExpenses.mock.calls.length).toBeGreaterThan(calls),
			SEARCH_DEBOUNCE_WAIT
		);
		await waitFor(() =>
			expect(screen.getByText('1 expense across 2 vehicles')).toBeInTheDocument()
		);
		expect(screen.queryByRole('button', { name: /Clear filters/i })).toBeNull();
	});

	test('with a filter on, the count says it matches the filters instead of naming every vehicle', async () => {
		await mountLoaded();
		getAllExpenses.mockResolvedValue(pageOf(ROWS.slice(0, 1), 1));
		await fireEvent.input(screen.getByRole('textbox', { name: 'Search expenses and vehicles' }), {
			target: { value: 'shell' }
		});
		expect(
			await screen.findByText('1 expense matches your filters', {}, SEARCH_DEBOUNCE_WAIT)
		).toBeInTheDocument();
		expect(screen.queryByText(/across \d+ vehicles?$/)).toBeNull();
	});
});

describe('/expenses loading states', () => {
	test('shows skeletons and no header until the first load finishes', async () => {
		getAllExpenses.mockReturnValue(new Promise(() => {}));
		const { container } = render(Page);

		await waitFor(() => expect(getAllExpenses).toHaveBeenCalled());
		expect(container.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0);
		expect(screen.queryByRole('heading', { name: 'All Expenses' })).toBeNull();
	});

	test('a failed first load shows the reason, and Retry loads the page', async () => {
		getAllExpenses.mockRejectedValueOnce(new Error('Server unavailable'));
		render(Page);

		expect(await screen.findByText("Couldn't load expenses")).toBeTruthy();
		expect(screen.getByText('Server unavailable.')).toBeTruthy();
		expect(captured.table['expenses']).toBeUndefined();

		await fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

		await waitFor(() => expect(captured.table['totalCount']).toBe(1));
		expect(screen.queryByText('Server unavailable.')).toBeNull();
	});

	test('a failed first summary also fails the first load', async () => {
		getExpenseSummary.mockRejectedValueOnce(new Error('Summary down'));
		render(Page);

		expect(await screen.findByText("Couldn't load expenses")).toBeTruthy();
		expect(screen.getByText('Summary down.')).toBeTruthy();
	});

	test('a non-Error first-load failure falls back to a generic reason', async () => {
		getVehicles.mockRejectedValueOnce('offline');
		render(Page);

		expect(await screen.findByText("Couldn't load expenses")).toBeTruthy();
		expect(screen.getByText(UNEXPECTED_FAILURE_MESSAGE)).toBeTruthy();
	});

	test('splits the offline queue into pending, needs attention and synced', async () => {
		const pending = offlineExpense('p', {});
		const stuck = offlineExpense('n', { needsAttention: true });
		const done = offlineExpense('s', { synced: true });
		offlineExpenseQueue.current = [pending, stuck, done];

		await mountLoaded();

		expect(captured.offlineCards['pendingExpenses']).toEqual([pending]);
		expect(captured.offlineCards['needsAttentionExpenses']).toEqual([stuck]);
		expect(captured.offlineCards['syncedExpenses']).toEqual([done]);
	});
});

describe('/expenses filters', () => {
	test('picking a vehicle filters the list and summary and offers to clear filters', async () => {
		await mountLoaded();
		expect(screen.queryByRole('button', { name: /Clear Filters/ })).toBeNull();
		expect(captured.table['hasActiveFilters']).toBe(false);

		await chooseVehicle('2020 Nissan Leaf');

		await waitFor(() => expect(lastListParams()).toMatchObject({ vehicleId: 'v2', offset: 0 }));
		expect(getExpenseSummary).toHaveBeenLastCalledWith({ vehicleId: 'v2' });
		expect(screen.getByRole('combobox', { name: 'Vehicle filter' }).textContent?.trim()).toContain(
			'2020 Nissan Leaf'
		);
		expect(screen.getByRole('button', { name: /Clear Filters/ })).toBeTruthy();
		expect(captured.table['hasActiveFilters']).toBe(true);
	});

	test('picking All Vehicles drops the vehicle filter again', async () => {
		await mountLoaded();
		await chooseVehicle('Daily Driver');
		await waitFor(() => expect(lastListParams()).toMatchObject({ vehicleId: 'v1' }));

		await chooseVehicle('All Vehicles');

		await waitFor(() => expect(lastListParams()).not.toHaveProperty('vehicleId'));
		expect(getExpenseSummary).toHaveBeenLastCalledWith({});
	});

	test('typing a search sends the trimmed term after a pause', async () => {
		await mountLoaded();
		const calls = getAllExpenses.mock.calls.length;

		await fireEvent.input(screen.getByRole('textbox', { name: 'Search expenses and vehicles' }), {
			target: { value: '  shell  ' }
		});

		await waitFor(
			() => expect(getAllExpenses.mock.calls.length).toBe(calls + 1),
			SEARCH_DEBOUNCE_WAIT
		);
		expect(lastListParams()).toMatchObject({ search: 'shell', offset: 0 });
	});

	test('a whitespace-only search sends no search term', async () => {
		await mountLoaded();
		const calls = getAllExpenses.mock.calls.length;

		await fireEvent.input(screen.getByRole('textbox', { name: 'Search expenses and vehicles' }), {
			target: { value: '   ' }
		});

		await waitFor(
			() => expect(getAllExpenses.mock.calls.length).toBe(calls + 1),
			SEARCH_DEBOUNCE_WAIT
		);
		expect(lastListParams()).not.toHaveProperty('search');
	});

	test('picking a date range filters by both ends and counts as an active filter', async () => {
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(new Date(2026, 5, 15, 12));
		try {
			await mountLoaded();

			await fireEvent.click(screen.getByRole('button', { name: /Date range/ }));
			const day = (value: string) =>
				document.querySelector(`[data-bits-day][data-value="${value}"]`) as HTMLElement;
			await waitFor(() => expect(day('2026-06-01')).not.toBeNull());
			await fireEvent.click(day('2026-06-01'));
			await fireEvent.click(day('2026-06-10'));

			await waitFor(() =>
				expect(lastListParams()).toMatchObject({
					startDate: '2026-06-01',
					endDate: '2026-06-10',
					offset: 0
				})
			);
			expect(captured.table['hasActiveFilters']).toBe(true);
		} finally {
			vi.useRealTimers();
		}
	});

	test('selecting a tag from the loaded expenses filters by it', async () => {
		await mountLoaded();

		await addTagFilter('roadtrip');

		await waitFor(() => expect(lastListParams()).toMatchObject({ tags: ['roadtrip'] }));
		expect(screen.getByRole('button', { name: 'Remove tag roadtrip' })).toBeTruthy();
	});

	test('the table category filter reloads only the list, from the first page', async () => {
		await mountLoaded();
		const summaryCalls = getExpenseSummary.mock.calls.length;

		callTable('onCategoryChange', 'maintenance');

		await waitFor(() =>
			expect(lastListParams()).toMatchObject({ category: 'maintenance', offset: 0 })
		);
		expect(getExpenseSummary).toHaveBeenCalledTimes(summaryCalls);
		await waitFor(() => expect(captured.table['activeCategory']).toBe('maintenance'));
		expect(captured.table['hasActiveFilters']).toBe(true);
	});

	test('the table sort reloads the list with the new order', async () => {
		await mountLoaded();

		callTable('onSortChange', 'amount', 'asc');

		await waitFor(() =>
			expect(lastListParams()).toMatchObject({ sortBy: 'amount', sortDir: 'asc' })
		);
		await waitFor(() => expect(captured.table['activeSortBy']).toBe('amount'));
		expect(captured.table['activeSortDir']).toBe('asc');
	});

	test('the mobile Filters button counts the sheet filters and opens them in a sheet', async () => {
		await mountLoaded();
		expect(screen.getByRole('button', { name: 'Filters' })).toBeTruthy();

		await chooseVehicle('2020 Nissan Leaf');
		await addTagFilter('commute');
		await waitFor(() => expect(screen.getByRole('button', { name: 'Filters · 2' })).toBeTruthy());

		await fireEvent.click(screen.getByRole('button', { name: 'Filters · 2' }));
		const sheet = await screen.findByRole('dialog', { name: 'Filters' });
		expect(within(sheet).getByRole('combobox', { name: 'Vehicle filter' })).toBeTruthy();
		expect(within(sheet).getByRole('combobox', { name: 'Search tags' })).toBeTruthy();

		expect(within(sheet).getByRole('button', { name: 'Close' })).toHaveClass('size-11');
		expect(
			within(sheet).getByRole('button', { name: 'Show results' }).parentElement?.className
		).toContain('env(safe-area-inset-bottom)');

		await fireEvent.click(within(sheet).getByRole('button', { name: 'Show results' }));
		await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Filters' })).toBeNull());
	});

	test('clearing filters resets every filter and reloads once', async () => {
		await mountLoaded();
		await chooseVehicle('Daily Driver');
		callTable('onCategoryChange', 'fuel');
		await addTagFilter('commute');
		await waitFor(() =>
			expect(lastListParams()).toMatchObject({
				vehicleId: 'v1',
				category: 'fuel',
				tags: ['commute']
			})
		);
		const calls = getAllExpenses.mock.calls.length;

		await fireEvent.click(screen.getByRole('button', { name: /Clear Filters/ }));

		await waitFor(
			() => expect(getAllExpenses.mock.calls.length).toBe(calls + 1),
			SEARCH_DEBOUNCE_WAIT
		);
		const params = lastListParams();
		expect(params).not.toHaveProperty('vehicleId');
		expect(params).not.toHaveProperty('category');
		expect(params).not.toHaveProperty('tags');
		expect(screen.queryByRole('button', { name: /Clear Filters/ })).toBeNull();
		expect(captured.table['hasActiveFilters']).toBe(false);
	});
});

describe('/expenses reloads and failures after the first load', () => {
	test('a summary failure on a filter change shows inline in the overview, with no toast, and Retry recovers', async () => {
		await mountLoaded();
		getAllExpenses.mockResolvedValue(pageOf([], 0));
		getExpenseSummary.mockRejectedValueOnce(new Error('Summary down'));

		await chooseVehicle('2020 Nissan Leaf');

		await waitFor(() => expect(captured.table['totalCount']).toBe(0));
		const card = await screen.findByTestId('expense-summary-error');
		expect(card).toHaveTextContent("Couldn't load the expense summary");
		expect(card).toHaveTextContent('Summary down.');
		expect(screen.queryByText('Expense Overview')).toBeNull();
		expect(notificationMessages()).toEqual([]);

		await fireEvent.click(within(card).getByRole('button', { name: 'Retry' }));

		await waitFor(() => expect(screen.queryByTestId('expense-summary-error')).toBeNull());
		expect(screen.getByText('Expense Overview')).toBeInTheDocument();
		expect(getExpenseSummary).toHaveBeenLastCalledWith({ vehicleId: 'v2' });
	});

	test('when list and summary both fail only the inline list error shows, with no toast', async () => {
		await mountLoaded();
		getAllExpenses.mockRejectedValueOnce(new Error('List down'));
		getExpenseSummary.mockRejectedValueOnce(new Error('Summary down'));

		await chooseVehicle('2020 Nissan Leaf');

		const error = await screen.findByTestId('expenses-page-error');
		expect(error.textContent).toContain('List down');
		expect(notificationMessages()).toEqual([]);
	});

	test('a non-Error page failure shows a generic message', async () => {
		await mountLoaded();
		getAllExpenses.mockRejectedValueOnce('boom');

		callTable('onPageChange', 20);

		const error = await screen.findByTestId('expenses-page-error');
		expect(error).toHaveTextContent("Couldn't load expenses");
		expect(error).toHaveTextContent(UNEXPECTED_FAILURE_MESSAGE);
	});

	test('deleting an expense reloads the current page and the summary', async () => {
		getAllExpenses.mockResolvedValue(pageOf(ROWS, 45));
		await mountLoaded();
		callTable('onPageChange', 20);
		await waitFor(() => expect(captured.table['currentOffset']).toBe(20));
		const summaryCalls = getExpenseSummary.mock.calls.length;

		await callTable('onDelete', ROWS[0]);

		expect(lastListParams()).toMatchObject({ offset: 20 });
		expect(getExpenseSummary).toHaveBeenCalledTimes(summaryCalls + 1);
	});
});

describe('/expenses import and export', () => {
	test('Export CSV is offered only when there are expenses', async () => {
		getAllExpenses.mockResolvedValue(pageOf([], 0));
		await mountLoaded();

		expect(screen.queryByRole('button', { name: 'Export CSV' })).toBeNull();
		expect(screen.getAllByRole('button', { name: 'Import CSV' }).length).toBeGreaterThan(0);
	});

	test('exporting sends the active filters and shows progress until done', async () => {
		let finish: () => void = () => {};
		downloadExpensesCsv.mockReturnValue(new Promise<void>(r => (finish = r)));
		await mountLoaded();
		await chooseVehicle('Daily Driver');
		await addTagFilter('commute');
		await waitFor(() => expect(lastListParams()).toMatchObject({ tags: ['commute'] }));

		await fireEvent.click(screen.getAllByRole('button', { name: 'Export CSV' })[0]!);

		expect(downloadExpensesCsv).toHaveBeenCalledWith({
			vehicleId: 'v1',
			category: undefined,
			startDate: undefined,
			endDate: undefined,
			search: undefined,
			tags: ['commute']
		});
		const busy = await screen.findAllByRole('button', { name: 'Exporting…' });
		expect(busy[0]).toBeDisabled();
		finish();
		await waitFor(() =>
			expect(screen.queryAllByRole('button', { name: 'Exporting…' })).toEqual([])
		);
	});

	test('exporting with a category and search passes them along', async () => {
		await mountLoaded();
		callTable('onCategoryChange', 'fuel');
		await fireEvent.input(screen.getByRole('textbox', { name: 'Search expenses and vehicles' }), {
			target: { value: ' shell ' }
		});

		await fireEvent.click(screen.getAllByRole('button', { name: 'Export CSV' })[0]!);

		expect(downloadExpensesCsv).toHaveBeenCalledWith(
			expect.objectContaining({ category: 'fuel', search: 'shell', tags: undefined })
		);
	});

	test('a failed export is reported', async () => {
		downloadExpensesCsv.mockRejectedValue(new Error('Disk full'));
		await mountLoaded();

		await fireEvent.click(screen.getAllByRole('button', { name: 'Export CSV' })[0]!);

		await waitFor(() =>
			expect(notificationMessages().some(m => m.includes('Disk full'))).toBe(true)
		);
		expect(screen.getAllByRole('button', { name: 'Export CSV' })[0]).not.toBeDisabled();
	});

	test('Import CSV opens its dialog and a finished import reloads from the first page', async () => {
		getAllExpenses.mockResolvedValue(pageOf(ROWS, 45));
		await mountLoaded();
		callTable('onPageChange', 20);
		await waitFor(() => expect(captured.table['currentOffset']).toBe(20));
		expect(captured.csvDialog['open']).toBe(false);

		await fireEvent.click(screen.getAllByRole('button', { name: 'Import CSV' })[0]!);
		expect(captured.csvDialog['open']).toBe(true);
		expect(captured.photosDialog['open']).toBe(false);

		(captured.csvDialog['onImported'] as () => void)();

		await waitFor(() => expect(captured.table['currentOffset']).toBe(0));
		expect(lastListParams()).toMatchObject({ offset: 0 });
	});

	test('Import from Photos opens the photos dialog', async () => {
		await mountLoaded();

		await fireEvent.click(screen.getAllByRole('button', { name: 'Import from Photos' })[0]!);

		expect(captured.photosDialog['open']).toBe(true);
		expect(captured.csvDialog['open']).toBe(false);
	});

	test('the mobile menu closes itself when a tool is picked', async () => {
		await mountLoaded();
		const trigger = screen.getByRole('button', { name: 'Import and export' });

		await fireEvent.click(trigger);
		await waitFor(() => expect(trigger.getAttribute('aria-expanded')).toBe('true'));
		const menuImport = screen.getAllByRole('button', { name: 'Import CSV' }).at(-1)!;
		await fireEvent.click(menuImport);

		expect(captured.csvDialog['open']).toBe(true);
		await waitFor(() => expect(trigger.getAttribute('aria-expanded')).toBe('false'));
	});

	test('exporting from the mobile menu closes it once the download finishes', async () => {
		await mountLoaded();
		const trigger = screen.getByRole('button', { name: 'Import and export' });
		await fireEvent.click(trigger);
		await waitFor(() => expect(trigger.getAttribute('aria-expanded')).toBe('true'));

		await fireEvent.click(screen.getAllByRole('button', { name: 'Export CSV' }).at(-1)!);

		await waitFor(() => expect(trigger.getAttribute('aria-expanded')).toBe('false'));
		expect(downloadExpensesCsv).toHaveBeenCalledTimes(1);
	});
});
