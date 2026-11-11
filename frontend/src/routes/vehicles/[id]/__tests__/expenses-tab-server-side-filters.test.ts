/**
 * The vehicle detail page's Expenses tab is PAGINATED, so every filter it offers has to be applied
 * by the server.
 *
 * It used to request `{ limit, offset, sortBy, sortDir }` and then narrow the 20 rows that came
 * back with a local array filter, while the card title ("All Expenses (N)") and the paginator kept
 * describing the whole set. A vehicle with 60 expenses answered a search for a row on page 3 with
 * the table's empty state next to a header that said 60 — indistinguishable from "you never logged
 * that". The table's category dropdown had the same defect, and the CSV export ignored the filters
 * altogether while its own contract promises the export matches what the user is viewing.
 *
 * These pin the REQUEST and what the table is handed, which is where the bug lived:
 *   - a search term and a category reach the API, and each restarts the page at offset 0 (a
 *     filtered set is a different set, so the offset you were on is meaningless in it);
 *   - the rows handed to the table are exactly the rows the server sent, un-narrowed — the thing
 *     that makes going server-side load-bearing rather than decorative;
 *   - the export carries the active filters.
 */

import { beforeEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, render, waitFor } from '@testing-library/svelte';
import type { Expense, Vehicle } from '$lib/types';

/**
 * Mounting needs svelte's CLIENT entries; this suite otherwise resolves the package's `default`
 * (server) ones because vite.config.ts sets no `browser` resolve condition for tests.
 */
vi.mock('svelte', () => import('../../../../../node_modules/svelte/src/index-client.js' as string));
vi.mock(
	'svelte/reactivity',
	() => import('../../../../../node_modules/svelte/src/reactivity/index-client.js' as string)
);

vi.mock('$app/navigation', () => ({ goto: vi.fn(() => Promise.resolve()) }));
vi.mock('$app/paths', () => ({ resolve: (path: string) => path }));

/**
 * The props the page hands ExpensesTable, captured by standing in for it. A Svelte 5 component is
 * just a `(anchor, props)` function, so a recorder is a legal one — and the props object it
 * receives carries live getters, so reading it later reads the page's CURRENT state.
 *
 * Standing in for the table rather than rendering it is deliberate: the fix under test is entirely
 * the page's (what it requests, and what it passes down), and the real table drags in the whole
 * bits-ui table/select/dialog tree for no added coverage.
 */
let tableProps: Record<string, unknown> = {};
vi.mock('$lib/components/expenses/ExpensesTable.svelte', () => ({
	default: (_anchor: unknown, props: Record<string, unknown>) => {
		tableProps = props;
	}
}));

// Charts, carousels and dialogs are irrelevant here and account for most of the route's module
// graph (layerchart/d3/embla), so they are stood in for too.
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

// Statically imported so the route's module graph is transformed at file load, outside any test's
// timeout (the same reason the other component suites import their subject at the top).
import Page from '../+page.svelte';

/** One page of rows the SERVER chose. The page must hand these to the table untouched. */
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

/** A multi-page set, so "restart at offset 0" and the header count are both meaningful. */
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

/** Render the route and open its Expenses tab. */
async function renderExpensesTab() {
	const screen = render(Page, { props: { data: { vehicleId: 'v1' } } });
	const tab = await waitFor(() => screen.getByRole('tab', { name: 'Expenses' }));
	await fireEvent.click(tab);
	await waitFor(() => expect(getExpensesByVehicle).toHaveBeenCalled());
	return screen;
}

/** The params object of the most recent list request. */
function lastListParams(): Record<string, unknown> {
	const call = getExpensesByVehicle.mock.calls.at(-1);
	expect(call, 'the expense list was requested at least once').toBeTruthy();
	return (call as unknown[])[1] as Record<string, unknown>;
}

/** The expense rows currently handed to the table. */
function rowsGivenToTable(): Expense[] {
	return (tableProps['expenses'] ?? []) as Expense[];
}

/**
 * The mount sequence. Photos are the one read that genuinely depends on the vehicle — it is
 * owner-only server-side, so firing it for a shared viewer buys nothing but a "vehicle not found"
 * toast. Summary, fuel efficiency and per-vehicle stats need only the route param, so making them
 * wait for the vehicle to come back costs a whole round trip on the app's heaviest route.
 */
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
		// ...and the one read that DOES depend on the vehicle has correctly held back.
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
		// Give any follow-up round a chance to fire before asserting it did not.
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

			// A term that matches NEITHER row's description, category or tags. A page that filtered
			// what it had been sent would hand the table nothing; a page that trusts the server
			// keeps passing on exactly what came back.
			const input = screen.getByRole('textbox', { name: 'Search expenses' });
			await fireEvent.input(input, { target: { value: 'zzz-matches-nothing-locally' } });
			await vi.advanceTimersByTimeAsync(400);

			await waitFor(() =>
				expect(lastListParams()).toMatchObject({ search: 'zzz-matches-nothing-locally' })
			);
			expect(rowsGivenToTable().map(e => e.id)).toEqual(['e1', 'e2']);
			// And the count beside them still describes the whole filtered set, not the page.
			expect(tableProps['totalCount']).toBe(TOTAL_COUNT);
		} finally {
			vi.useRealTimers();
		}
	});

	test('the category axis is CONTROLLED by the page and sent to the API from offset 0', async () => {
		await renderExpensesTab();

		// Handing the table `onCategoryChange` is what switches its dropdown out of the local mode
		// that could only ever narrow the page it was given.
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
