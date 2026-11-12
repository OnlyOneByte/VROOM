import { beforeEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, render, waitFor } from '@testing-library/svelte';
import type { Expense, Vehicle } from '$lib/types';

vi.mock('$app/navigation', () => ({ goto: vi.fn(() => Promise.resolve()) }));
vi.mock('$app/paths', () => ({ resolve: (path: string) => path }));

let tableProps: Record<string, unknown> = {};
vi.mock('$lib/components/expenses/ExpensesTable.svelte', () => ({
	default: (_anchor: unknown, props: Record<string, unknown>) => {
		tableProps = props;
	}
}));

vi.mock('$lib/components/charts', () => ({ AppPieChart: () => {} }));
vi.mock('$lib/components/charts/ExpenseTrendChart.svelte', () => ({ default: () => {} }));
vi.mock('$lib/components/charts/FuelEfficiencyTrendChart.svelte', () => ({ default: () => {} }));
vi.mock('$lib/components/vehicles/VehiclePhotoCarousel.svelte', () => ({ default: () => {} }));
vi.mock('$lib/components/vehicles/FinanceTab.svelte', () => ({ default: () => {} }));
vi.mock('$lib/components/vehicles/OdometerTab.svelte', () => ({ default: () => {} }));
vi.mock('$lib/components/vehicles/ShareVehicleDialog.svelte', () => ({ default: () => {} }));
vi.mock('$lib/components/vehicles/FuelEfficiencyStatsCard.svelte', () => ({ default: () => {} }));
vi.mock('$lib/components/common/MediaCaptureDialog.svelte', () => ({ default: () => {} }));

const getExpensesByVehicle = vi.fn();
const getExpenseSummary = vi.fn();
const downloadExpensesCsv = vi.fn((_params?: Record<string, unknown>) => Promise.resolve());

vi.mock('$lib/services/expense-api', () => ({
	expenseApi: {
		getExpensesByVehicle: (...args: unknown[]) => getExpensesByVehicle(...args),
		getExpenseSummary: (...args: unknown[]) => getExpenseSummary(...args),
		downloadExpensesCsv: (params?: Record<string, unknown>) => downloadExpensesCsv(params)
	}
}));

const VEHICLE: Vehicle = {
	id: 'v1',
	userId: 'u1',
	make: 'Toyota',
	model: 'Camry',
	year: 2020,
	vehicleType: 'car',
	nickname: 'Daily Driver',
	createdAt: '2024-01-01T00:00:00.000Z',
	updatedAt: '2024-01-01T00:00:00.000Z'
} as unknown as Vehicle;

const getVehicle = vi.fn();
const getVehicleStats = vi.fn();
const getPhotos = vi.fn();
const getFuelEfficiency = vi.fn();

vi.mock('$lib/services/vehicle-api', () => ({
	vehicleApi: {
		getVehicle: (...args: unknown[]) => getVehicle(...args),
		getVehicleStats: (...args: unknown[]) => getVehicleStats(...args),
		getPhotos: (...args: unknown[]) => getPhotos(...args),
		getPhotoThumbnailUrl: () => '',
		uploadPhoto: () => Promise.resolve({}),
		deletePhoto: () => Promise.resolve(),
		setCoverPhoto: () => Promise.resolve({})
	}
}));

vi.mock('$lib/services/analytics-api', () => ({
	analyticsApi: { getFuelEfficiency: (...args: unknown[]) => getFuelEfficiency(...args) }
}));

import Page from '../+page.svelte';

const SERVER_PAGE: Expense[] = [
	{
		id: 'e1',
		vehicleId: 'v1',
		userId: 'u1',
		category: 'fuel',
		amount: 45.5,
		date: '2024-03-15T12:00:00.000Z',
		description: 'Shell',
		tags: [],
		createdAt: '2024-03-15T12:00:00.000Z',
		updatedAt: '2024-03-15T12:00:00.000Z'
	},
	{
		id: 'e2',
		vehicleId: 'v1',
		userId: 'u1',
		category: 'maintenance',
		amount: 220,
		date: '2024-02-02T12:00:00.000Z',
		description: 'Brake pads',
		tags: ['winter-tires'],
		createdAt: '2024-02-02T12:00:00.000Z',
		updatedAt: '2024-02-02T12:00:00.000Z'
	}
] as unknown as Expense[];

const TOTAL_COUNT = 60;

beforeEach(() => {
	vi.clearAllMocks();
	tableProps = {};
	getVehicle.mockImplementation(() => Promise.resolve(VEHICLE));
	getVehicleStats.mockImplementation(() => Promise.resolve(null));
	getPhotos.mockImplementation(() => Promise.resolve({ data: [] }));
	getFuelEfficiency.mockImplementation(() => Promise.resolve({ fuelEfficiencyTrend: [] }));
	getExpensesByVehicle.mockImplementation(() =>
		Promise.resolve({
			data: SERVER_PAGE,
			pagination: { totalCount: TOTAL_COUNT, limit: 20, offset: 0, hasMore: true }
		})
	);
	getExpenseSummary.mockImplementation(() =>
		Promise.resolve({
			totalAmount: 5000,
			expenseCount: TOTAL_COUNT,
			recentAmount: 100,
			monthlyAverage: 400,
			categoryBreakdown: [],
			monthlyTrend: []
		})
	);
});

async function renderExpensesTab() {
	const screen = render(Page, { props: { data: { vehicleId: 'v1' } } });
	const tab = await waitFor(() => screen.getByRole('tab', { name: 'Expenses' }));
	await fireEvent.click(tab);
	await waitFor(() => expect(getExpensesByVehicle).toHaveBeenCalled());
	return screen;
}

function lastListParams(): Record<string, unknown> {
	const call = getExpensesByVehicle.mock.calls.at(-1);
	expect(call, 'the expense list was requested at least once').toBeTruthy();
	return (call as unknown[])[1] as Record<string, unknown>;
}

function rowsGivenToTable(): Expense[] {
	return (tableProps['expenses'] ?? []) as Expense[];
}

describe('vehicle detail mount — only the photos read waits for the vehicle', () => {
	test('summary, fuel efficiency and stats go out WHILE the vehicle request is still pending', async () => {
		let releaseVehicle: (vehicle: Vehicle) => void = () => {};
		getVehicle.mockImplementation(
			() =>
				new Promise<Vehicle>(resolve => {
					releaseVehicle = resolve;
				})
		);

		render(Page, { props: { data: { vehicleId: 'v1' } } });

		await waitFor(() => {
			expect(getExpenseSummary).toHaveBeenCalled();
			expect(getFuelEfficiency).toHaveBeenCalled();
			expect(getVehicleStats).toHaveBeenCalled();
		});
		expect(getPhotos).not.toHaveBeenCalled();

		releaseVehicle(VEHICLE);
		await waitFor(() => expect(getPhotos).toHaveBeenCalled());
	});

	test('a shared viewer never triggers the owner-only photos read', async () => {
		getVehicle.mockImplementation(() =>
			Promise.resolve({
				...VEHICLE,
				sharedAccess: { level: 'viewer', sharedBy: 'someone@example.com' }
			} as unknown as Vehicle)
		);

		render(Page, { props: { data: { vehicleId: 'v1' } } });

		await waitFor(() => expect(getExpenseSummary).toHaveBeenCalled());
		await waitFor(() => expect(getVehicle).toHaveBeenCalled());
		await new Promise(resolve => setTimeout(resolve, 50));
		expect(getPhotos).not.toHaveBeenCalled();
	});
});

describe('vehicle Expenses tab — filters are applied by the server, across all pages', () => {
	test('a search term reaches the API and the page restarts at offset 0', async () => {
		vi.useFakeTimers({ shouldAdvanceTime: true });
		try {
			const screen = await renderExpensesTab();
			expect(lastListParams()).not.toHaveProperty('search');
			const callsBefore = getExpensesByVehicle.mock.calls.length;

			const input = screen.getByRole('textbox', { name: 'Search expenses' });
			await fireEvent.input(input, { target: { value: 'tires' } });
			await vi.advanceTimersByTimeAsync(400);

			await waitFor(() =>
				expect(getExpensesByVehicle.mock.calls.length).toBeGreaterThan(callsBefore)
			);
			expect(lastListParams()).toMatchObject({ search: 'tires', offset: 0 });
		} finally {
			vi.useRealTimers();
		}
	});

	test('the search is DEBOUNCED — typing does not fire a request per keystroke', async () => {
		vi.useFakeTimers({ shouldAdvanceTime: true });
		try {
			const screen = await renderExpensesTab();
			const callsBefore = getExpensesByVehicle.mock.calls.length;
			const input = screen.getByRole('textbox', { name: 'Search expenses' });

			for (const value of ['t', 'ti', 'tir', 'tire', 'tires']) {
				await fireEvent.input(input, { target: { value } });
				await vi.advanceTimersByTimeAsync(50);
			}
			await vi.advanceTimersByTimeAsync(400);

			await waitFor(() => expect(lastListParams()).toMatchObject({ search: 'tires' }));
			expect(getExpensesByVehicle.mock.calls.length - callsBefore).toBe(1);
		} finally {
			vi.useRealTimers();
		}
	});

	test('the table is handed the rows the SERVER returned, with no local narrowing', async () => {
		vi.useFakeTimers({ shouldAdvanceTime: true });
		try {
			const screen = await renderExpensesTab();
			await waitFor(() => expect(rowsGivenToTable()).toHaveLength(SERVER_PAGE.length));

			const input = screen.getByRole('textbox', { name: 'Search expenses' });
			await fireEvent.input(input, { target: { value: 'zzz-matches-nothing-locally' } });
			await vi.advanceTimersByTimeAsync(400);

			await waitFor(() =>
				expect(lastListParams()).toMatchObject({ search: 'zzz-matches-nothing-locally' })
			);
			expect(rowsGivenToTable().map(e => e.id)).toEqual(['e1', 'e2']);
			expect(tableProps['totalCount']).toBe(TOTAL_COUNT);
		} finally {
			vi.useRealTimers();
		}
	});

	test('the category axis is CONTROLLED by the page and sent to the API from offset 0', async () => {
		await renderExpensesTab();

		const onCategoryChange = tableProps['onCategoryChange'] as ((_c: string) => void) | undefined;
		expect(onCategoryChange, 'the table is given a category handler').toBeTypeOf('function');

		onCategoryChange!('maintenance');

		await waitFor(() => expect(lastListParams()).toMatchObject({ category: 'maintenance' }));
		expect(lastListParams()).toMatchObject({ offset: 0 });
		expect(tableProps['activeCategory']).toBe('maintenance');
		expect(tableProps['hasActiveFilters']).toBe(true);
	});

	test('CSV export carries the active search, not just the vehicle id', async () => {
		vi.useFakeTimers({ shouldAdvanceTime: true });
		try {
			const screen = await renderExpensesTab();
			const input = screen.getByRole('textbox', { name: 'Search expenses' });
			await fireEvent.input(input, { target: { value: 'brake' } });
			await vi.advanceTimersByTimeAsync(400);
			await waitFor(() => expect(lastListParams()).toMatchObject({ search: 'brake' }));

			await fireEvent.click(screen.getByRole('button', { name: /export csv/i }));

			await waitFor(() => expect(downloadExpensesCsv).toHaveBeenCalled());
			expect(downloadExpensesCsv.mock.calls.at(-1)?.[0]).toMatchObject({
				vehicleId: 'v1',
				search: 'brake'
			});
		} finally {
			vi.useRealTimers();
		}
	});
});
