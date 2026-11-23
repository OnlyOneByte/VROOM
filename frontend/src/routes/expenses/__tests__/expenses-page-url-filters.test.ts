import { beforeEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import type { UserSettings, Vehicle } from '#lib/types/index.ts';

const nav = vi.hoisted(() => ({
	page: { url: new URL('http://localhost/expenses'), state: {} },
	replaceState: vi.fn()
}));

vi.mock('$app/navigation', () => ({
	goto: vi.fn(() => Promise.resolve()),
	replaceState: (url: string, state: unknown) => {
		nav.replaceState(url, state);
		nav.page.url = new URL(url, nav.page.url);
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

vi.mock('#lib/services/expense-api.ts', () => ({
	expenseApi: {
		getAllExpenses: (...args: unknown[]) => getAllExpenses(...args),
		getExpenseSummary: (...args: unknown[]) => getExpenseSummary(...args),
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
	render(Page);
}

function lastListParams(): Record<string, unknown> {
	return (getAllExpenses.mock.lastCall?.[0] ?? {}) as Record<string, unknown>;
}

beforeEach(() => {
	settingsStore.reset();
	vi.clearAllMocks();
	tableProps = {};
	onlineStatus.current = true;
	offlineExpenseQueue.current = [];
	getVehicles.mockResolvedValue([VEHICLE]);
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
});
