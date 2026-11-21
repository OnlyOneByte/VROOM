import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import type { Expense, ExpenseSummary, Vehicle } from '#lib/types/index.ts';
import { ApiError } from '#lib/utils/error-handling.ts';

const goto = vi.fn((_url: string) => Promise.resolve());
vi.mock('$app/navigation', () => ({ goto: (url: string) => goto(url) }));
vi.mock('$app/paths', () => ({
	resolve: (path: string, params: Record<string, string> = {}) =>
		path.replace(/\[(\w+)\]/g, (_m, key: string) => params[key] ?? '')
}));

const handleErrorWithNotification = vi.fn<(error: unknown, context?: string) => void>();
vi.mock('#lib/utils/error-handling.ts', async importOriginal => ({
	...(await importOriginal<typeof import('#lib/utils/error-handling.ts')>()),
	handleErrorWithNotification: (error: unknown, context?: string) =>
		handleErrorWithNotification(error, context)
}));

const captured: Record<string, Record<string, unknown>> = {};
function capture(name: string) {
	return {
		default: (_anchor: unknown, props: Record<string, unknown>) => {
			captured[name] = props;
		}
	};
}

vi.mock('#lib/components/expenses/ExpensesTable.svelte', () => capture('table'));
vi.mock('#lib/components/charts/index.ts', () => ({
	AppPieChart: (_anchor: unknown, props: Record<string, unknown>) => {
		captured['pie'] = props;
	}
}));
vi.mock('#lib/components/charts/ExpenseTrendChart.svelte', () => capture('trend'));
vi.mock('#lib/components/charts/FuelEfficiencyTrendChart.svelte', () => capture('fuelTrend'));
vi.mock('#lib/components/vehicles/VehiclePhotoCarousel.svelte', () => capture('photos'));
vi.mock('#lib/components/vehicles/FinanceTab.svelte', () => capture('finance'));
vi.mock('#lib/components/vehicles/OdometerTab.svelte', () => capture('odometer'));
vi.mock('#lib/components/vehicles/ShareVehicleDialog.svelte', () => capture('share'));
vi.mock('#lib/components/vehicles/FuelEfficiencyStatsCard.svelte', () => capture('fuelStats'));
vi.mock('#lib/components/common/MediaCaptureDialog.svelte', () => capture('media'));
vi.mock('#lib/components/common/period-selector.svelte', () => capture('period'));
vi.mock('#lib/components/insurance/InsuranceTab.svelte', () => capture('insurance'));

const getExpensesByVehicle = vi.fn();
const getExpenseSummary = vi.fn();
const downloadExpensesCsv = vi.fn();

vi.mock('#lib/services/expense-api.ts', () => ({
	expenseApi: {
		getExpensesByVehicle: (...args: unknown[]) => getExpensesByVehicle(...args),
		getExpenseSummary: (...args: unknown[]) => getExpenseSummary(...args),
		downloadExpensesCsv: (...args: unknown[]) => downloadExpensesCsv(...args)
	}
}));

const getVehicle = vi.fn();
const getVehicleStats = vi.fn();
const getPhotos = vi.fn();
const getFuelEfficiency = vi.fn();

vi.mock('#lib/services/vehicle-api.ts', () => ({
	vehicleApi: {
		getVehicle: (...args: unknown[]) => getVehicle(...args),
		getVehicleStats: (...args: unknown[]) => getVehicleStats(...args),
		getPhotos: (...args: unknown[]) => getPhotos(...args),
		getPhotoThumbnailUrl: (vehicleId: string, photoId: string) => `/thumb/${vehicleId}/${photoId}`,
		uploadPhoto: () => Promise.resolve({}),
		deletePhoto: () => Promise.resolve(),
		setCoverPhoto: () => Promise.resolve({})
	}
}));

vi.mock('#lib/services/analytics-api.ts', () => ({
	analyticsApi: { getFuelEfficiency: (...args: unknown[]) => getFuelEfficiency(...args) }
}));

import Page from '../+page.svelte';

const VEHICLE = {
	id: 'v1',
	userId: 'u1',
	make: 'Toyota',
	model: 'Camry',
	year: 2020,
	vehicleType: 'gas',
	nickname: 'Daily Driver',
	unitPreferences: { distanceUnit: 'kilometers', volumeUnit: 'liters', chargeUnit: 'kwh' },
	createdAt: '2024-01-01T00:00:00.000Z',
	updatedAt: '2024-01-01T00:00:00.000Z'
} as unknown as Vehicle;

const VIEWER_VEHICLE = {
	...VEHICLE,
	sharedAccess: { level: 'viewer', sharedBy: 'owner@example.com' }
} as unknown as Vehicle;

const EDITOR_VEHICLE = {
	...VEHICLE,
	sharedAccess: { level: 'editor', sharedBy: 'owner@example.com' }
} as unknown as Vehicle;

const EMPTY_SUMMARY: ExpenseSummary = {
	totalAmount: 0,
	expenseCount: 0,
	recentAmount: 0,
	monthlyAverage: 0,
	categoryBreakdown: [],
	monthlyTrend: []
} as unknown as ExpenseSummary;

const DATA_SUMMARY = {
	totalAmount: 1500,
	expenseCount: 3,
	recentAmount: 200,
	monthlyAverage: 125,
	categoryBreakdown: [
		{ category: 'fuel', amount: 300 },
		{ category: 'maintenance', amount: 1200 }
	],
	monthlyTrend: [{ period: '2026-10', amount: 1500, count: 3 }]
} as unknown as ExpenseSummary;

const EXPENSE = {
	id: 'e1',
	vehicleId: 'v1',
	userId: 'u1',
	category: 'fuel',
	amount: 45.5,
	date: '2024-03-15T12:00:00.000Z',
	tags: [],
	createdAt: '2024-03-15T12:00:00.000Z',
	updatedAt: '2024-03-15T12:00:00.000Z'
} as unknown as Expense;

async function settle(): Promise<void> {
	for (let i = 0; i < 10; i++) {
		await new Promise(resolve => setTimeout(resolve, 0));
	}
}

async function mount() {
	const view = render(Page, { props: { data: { vehicleId: 'v1' } } as never });
	await settle();
	return view;
}

async function openTab(name: string) {
	await fireEvent.click(screen.getByRole('tab', { name }));
	await settle();
}

async function openExpensesTable(): Promise<Record<string, unknown>> {
	await openTab('Expenses');
	await vi.waitFor(() => expect(captured['table']).toBeDefined());
	return captured['table'] as Record<string, unknown>;
}

function lastListParams(): Record<string, unknown> {
	return getExpensesByVehicle.mock.calls.at(-1)?.[1] as Record<string, unknown>;
}

beforeEach(() => {
	vi.clearAllMocks();
	for (const key of Object.keys(captured)) delete captured[key];
	getVehicle.mockResolvedValue(VEHICLE);
	getVehicleStats.mockResolvedValue(null);
	getPhotos.mockResolvedValue({ data: [] });
	getFuelEfficiency.mockResolvedValue({ fuelEfficiencyTrend: [] });
	getExpenseSummary.mockResolvedValue(EMPTY_SUMMARY);
	getExpensesByVehicle.mockResolvedValue({
		data: [EXPENSE],
		pagination: { totalCount: 1, limit: 20, offset: 0, hasMore: false }
	});
	downloadExpensesCsv.mockResolvedValue(undefined);
});

afterEach(() => {
	cleanup();
});

describe('vehicle detail page loading and not-found', () => {
	test('shows skeletons and no tabs while the vehicle is loading', async () => {
		getVehicle.mockReturnValue(new Promise(() => {}));
		const { container } = await mount();

		expect(container.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0);
		expect(screen.queryByRole('tab', { name: 'Overview' })).toBeNull();
	});

	test('a missing vehicle notifies, redirects to the dashboard and shows not-found', async () => {
		const failure = new ApiError('Vehicle not found', 404);
		getVehicle.mockRejectedValue(failure);
		await mount();

		expect(handleErrorWithNotification).toHaveBeenCalledWith(failure, 'Failed to load vehicle');
		expect(goto).toHaveBeenCalledWith('/dashboard');
		expect(screen.getByText('Vehicle not found')).toBeInTheDocument();
		expect(screen.queryByRole('tab', { name: 'Overview' })).toBeNull();
		expect(getPhotos).not.toHaveBeenCalled();
	});

	test('Back to Dashboard on the not-found state navigates to the dashboard', async () => {
		getVehicle.mockRejectedValue(new ApiError('Vehicle not found', 404));
		await mount();
		goto.mockClear();

		await fireEvent.click(screen.getByRole('button', { name: 'Back to Dashboard' }));

		expect(goto).toHaveBeenCalledWith('/dashboard');
	});
});

describe('vehicle detail page overview', () => {
	test('the nickname titles the page and the owner sees Share and Add Expense', async () => {
		await mount();

		expect(document.title).toBe('Daily Driver - VROOM Car Tracker');
		expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true');
		expect(screen.getByRole('button', { name: 'Share' })).toBeInTheDocument();
		expect(captured['share']?.['vehicleName']).toBe('Daily Driver');
		expect(screen.getAllByRole('link', { name: /Add Expense/ })[0]).toHaveAttribute(
			'href',
			'/expenses/new?vehicleId=v1&returnTo=/vehicles/v1'
		);
	});

	test('without a nickname the title is year, make and model', async () => {
		getVehicle.mockResolvedValue({ ...VEHICLE, nickname: null });
		await mount();

		expect(document.title).toBe('2020 Toyota Camry - VROOM Car Tracker');
	});

	test('Share opens the share dialog for this vehicle', async () => {
		await mount();
		expect(captured['share']?.['open']).toBe(false);

		await fireEvent.click(screen.getByRole('button', { name: 'Share' }));

		expect(captured['share']?.['open']).toBe(true);
		expect(captured['share']?.['vehicleId']).toBe('v1');
	});

	test('the first Upload Photos tap mounts the upload dialog open', async () => {
		await mount();
		expect(captured['media']).toBeUndefined();
		expect(captured['photos']?.['onUpload']).toBeTypeOf('function');

		(captured['photos']?.['onUpload'] as () => void)();
		await settle();

		expect(captured['media']?.['open']).toBe(true);
		expect(captured['media']?.['title']).toBe('Upload Vehicle Photos');
	});

	test('a vehicle with no expenses shows the no-expenses empty state', async () => {
		await mount();

		expect(screen.getByText('No expenses yet')).toBeInTheDocument();
		expect(captured['period']).toBeUndefined();
	});

	test('a shared viewer cannot share, add expenses or load owner-only photos', async () => {
		getVehicle.mockResolvedValue(VIEWER_VEHICLE);
		await mount();

		expect(screen.getByText('No expenses yet')).toBeInTheDocument();
		expect(screen.queryByRole('button', { name: 'Share' })).toBeNull();
		expect(screen.queryByRole('link', { name: /Add Expense/ })).toBeNull();
		expect(captured['share']).toBeUndefined();
		expect(getPhotos).not.toHaveBeenCalled();
		expect(captured['photos']?.['isOwner']).toBe(false);
	});

	test('a shared editor can add expenses but not share', async () => {
		getVehicle.mockResolvedValue(EDITOR_VEHICLE);
		await mount();

		expect(screen.queryByRole('button', { name: 'Share' })).toBeNull();
		expect(screen.getAllByRole('link', { name: /Add Expense/ }).length).toBeGreaterThan(0);
	});

	test('the cover photo becomes the header image', async () => {
		getPhotos.mockResolvedValue({
			data: [
				{ id: 'p1', isCover: false },
				{ id: 'p2', isCover: true }
			]
		});
		const { container } = await mount();

		expect(captured['photos']?.['photos']).toHaveLength(2);
		expect(container.querySelector('img[src="/thumb/v1/p2"]')).not.toBeNull();
	});

	test('the insurance section is loaded lazily on the overview', async () => {
		await mount();

		await waitFor(() => expect(captured['insurance']).toBeDefined());
		expect(captured['insurance']?.['vehicleId']).toBe('v1');
		expect(captured['insurance']?.['readOnly']).toBe(false);
	});

	test('a summary failure shows the error and Retry reloads into the data view', async () => {
		const failure = new Error('Summary service down');
		getExpenseSummary.mockRejectedValueOnce(failure);
		getExpenseSummary.mockResolvedValueOnce(DATA_SUMMARY);
		await mount();

		expect(handleErrorWithNotification).toHaveBeenCalledWith(
			failure,
			'Failed to load expense summary'
		);
		expect(screen.getByText('Failed to load expense summary')).toBeInTheDocument();
		expect(screen.getByText('Check your connection and try again.')).toBeInTheDocument();
		expect(screen.queryByText('Summary service down')).toBeNull();

		await fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
		await settle();

		expect(getExpenseSummary).toHaveBeenCalledTimes(2);
		expect(screen.queryByText('Failed to load expense summary')).toBeNull();
		expect(captured['period']).toBeDefined();
	});

	test('a non-Error summary failure shows the same title and hint', async () => {
		getExpenseSummary.mockRejectedValueOnce('boom');
		await mount();

		expect(screen.getAllByText('Failed to load expense summary')).toHaveLength(1);
		expect(screen.getByText('Check your connection and try again.')).toBeInTheDocument();
	});

	test('with expenses the overview hands the period, trend and category data to its cards', async () => {
		getExpenseSummary.mockResolvedValue(DATA_SUMMARY);
		getFuelEfficiency.mockResolvedValue({
			fuelEfficiencyTrend: [{ date: '2026-10-01', efficiency: 30, mileage: 1000 }]
		});
		await mount();

		expect(captured['period']?.['selectedPeriod']).toBe('all');
		expect(captured['trend']?.['description']).toBe('All Time');
		expect(captured['trend']?.['data']).toHaveLength(1);
		expect(captured['fuelTrend']?.['fuelType']).toBe('gas');
		expect(captured['fuelTrend']?.['data']).toHaveLength(1);
		const pie = captured['pie']?.['data'] as { key: string }[];
		expect(pie.map(slice => slice.key)).toEqual(['maintenance', 'fuel']);
	});

	test('a category breakdown that totals zero draws no pie chart', async () => {
		getExpenseSummary.mockResolvedValue({
			...DATA_SUMMARY,
			categoryBreakdown: [{ category: 'fuel', amount: 0 }]
		});
		await mount();

		expect(captured['period']).toBeDefined();
		expect(captured['pie']).toBeUndefined();
	});

	test('changing the period refetches stats and summary for that period', async () => {
		getExpenseSummary.mockResolvedValue(DATA_SUMMARY);
		await mount();
		const onPeriodChange = captured['period']?.['onPeriodChange'] as (p: string) => void;

		onPeriodChange('30d');
		await settle();

		expect(getVehicleStats).toHaveBeenLastCalledWith('v1', '30d');
		expect(getExpenseSummary).toHaveBeenLastCalledWith({ vehicleId: 'v1', period: '30d' });
		expect(captured['trend']?.['description']).toBe('Last 30d');
	});

	test('fuel efficiency, stats and photo failures are reported without blocking the page', async () => {
		getFuelEfficiency.mockRejectedValue(new Error('a'));
		getVehicleStats.mockRejectedValue(new Error('b'));
		getPhotos.mockRejectedValue(new Error('c'));
		await mount();

		const contexts = handleErrorWithNotification.mock.calls.map(call => call[1]);
		expect(contexts).toEqual(
			expect.arrayContaining([
				'Failed to load fuel efficiency data',
				'Failed to load vehicle statistics',
				'Failed to load photos'
			])
		);
		expect(screen.getByRole('tab', { name: 'Overview' })).toBeInTheDocument();
	});
});

describe('vehicle detail page tabs', () => {
	test('the Odometer tab renders the odometer list with the vehicle units and write access', async () => {
		await mount();

		await openTab('Odometer');

		expect(screen.getByRole('tab', { name: 'Odometer' })).toHaveAttribute('aria-selected', 'true');
		expect(captured['odometer']?.['vehicleId']).toBe('v1');
		expect(captured['odometer']?.['canWrite']).toBe(true);
		expect(captured['odometer']?.['unitPreferences']).toEqual(VEHICLE.unitPreferences);
	});

	test('a viewer gets a read-only odometer tab', async () => {
		getVehicle.mockResolvedValue(VIEWER_VEHICLE);
		await mount();

		await openTab('Odometer');

		expect(captured['odometer']?.['canWrite']).toBe(false);
	});

	test('the Expenses tab loads the first page only once, on first open', async () => {
		await mount();
		expect(getExpensesByVehicle).not.toHaveBeenCalled();

		await openTab('Expenses');
		await openTab('Overview');
		await openExpensesTable();

		expect(getExpensesByVehicle).toHaveBeenCalledTimes(1);
		expect(lastListParams()).toMatchObject({
			limit: 20,
			offset: 0,
			sortBy: 'date',
			sortDir: 'desc'
		});
		expect(await screen.findByText('All Expenses (1)')).toBeInTheDocument();
		expect(captured['table']?.['expenses']).toEqual([EXPENSE]);
	});

	test('an expenses load failure shows the error and Retry refetches the same page', async () => {
		const failure = new Error('Expenses down');
		getExpensesByVehicle.mockRejectedValueOnce(failure);
		await mount();

		await openTab('Expenses');

		expect(await screen.findByText('Failed to load expenses')).toBeInTheDocument();
		expect(handleErrorWithNotification).toHaveBeenCalledWith(failure, 'Failed to load expenses');
		expect(screen.getByText('Check your connection and try again.')).toBeInTheDocument();
		expect(screen.queryByText('Expenses down')).toBeNull();

		await fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
		await settle();

		expect(getExpensesByVehicle).toHaveBeenCalledTimes(2);
		expect(lastListParams()).toMatchObject({ offset: 0 });
		expect(captured['table']?.['expenses']).toEqual([EXPENSE]);
	});

	test('a non-Error expenses failure shows the same title and hint', async () => {
		getExpensesByVehicle.mockRejectedValueOnce('boom');
		await mount();

		await openTab('Expenses');

		expect(await screen.findAllByText('Failed to load expenses')).toHaveLength(1);
		expect(screen.getByText('Check your connection and try again.')).toBeInTheDocument();
	});

	test('paging and sorting from the table refetch with the new parameters', async () => {
		await mount();
		await openExpensesTable();

		(captured['table']?.['onPageChange'] as (offset: number) => void)(20);
		await settle();
		expect(lastListParams()).toMatchObject({ offset: 20 });

		(captured['table']?.['onSortChange'] as (by: string, dir: string) => void)('amount', 'asc');
		await settle();
		expect(lastListParams()).toMatchObject({ offset: 0, sortBy: 'amount', sortDir: 'asc' });
		expect(captured['table']?.['activeSortBy']).toBe('amount');
	});

	test('deleting the only row on a later page steps back a page and refreshes the summary', async () => {
		getExpensesByVehicle.mockResolvedValue({
			data: [EXPENSE],
			pagination: { totalCount: 21, limit: 20, offset: 20, hasMore: false }
		});
		await mount();
		await openExpensesTable();
		(captured['table']?.['onPageChange'] as (offset: number) => void)(20);
		await settle();
		const summaryCalls = getExpenseSummary.mock.calls.length;

		await (captured['table']?.['onDelete'] as (e: Expense) => Promise<void>)(EXPENSE);
		await settle();

		expect(lastListParams()).toMatchObject({ offset: 0 });
		expect(getExpenseSummary.mock.calls.length).toBe(summaryCalls + 1);
	});

	test('clearing filters resets the category and reloads from the first page', async () => {
		await mount();
		await openExpensesTable();
		(captured['table']?.['onCategoryChange'] as (c: string) => void)('fuel');
		await settle();
		expect(lastListParams()).toMatchObject({ category: 'fuel' });

		(captured['table']?.['onClearFilters'] as () => void)();
		await settle();

		expect(lastListParams()).not.toHaveProperty('category');
		expect(captured['table']?.['hasActiveFilters']).toBe(false);
	});

	test('a failed CSV export is reported and the button recovers', async () => {
		const failure = new Error('export failed');
		downloadExpensesCsv.mockRejectedValue(failure);
		await mount();
		await openTab('Expenses');

		await fireEvent.click(await screen.findByRole('button', { name: /export csv/i }));
		await settle();

		expect(handleErrorWithNotification).toHaveBeenCalledWith(failure, 'Failed to export expenses');
		expect(screen.getByRole('button', { name: /export csv/i })).toBeEnabled();
	});

	test('shared users cannot export CSV', async () => {
		getVehicle.mockResolvedValue(EDITOR_VEHICLE);
		await mount();
		await openExpensesTable();
		expect(await screen.findByText('All Expenses (1)')).toBeInTheDocument();

		expect(screen.queryByRole('button', { name: /export csv/i })).toBeNull();
		expect(captured['table']?.['canWrite']).toBe(true);
	});
});
