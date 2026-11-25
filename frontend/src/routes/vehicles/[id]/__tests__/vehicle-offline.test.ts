import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { render, waitFor } from '@testing-library/svelte';
import type { Vehicle } from '#lib/types/index.ts';
import { NetworkError } from '#lib/utils/error-handling.ts';

const goto = vi.fn((_url: string) => Promise.resolve());
vi.mock('$app/navigation', () => ({ goto: (url: string) => goto(url) }));
vi.mock('$app/paths', () => ({ resolve: (path: string) => path }));

vi.mock('#lib/components/expenses/ExpensesTable.svelte', () => ({ default: () => {} }));
vi.mock('#lib/components/charts/index.ts', () => ({ AppPieChart: () => {} }));
vi.mock('#lib/components/charts/ExpenseTrendChart.svelte', () => ({ default: () => {} }));
vi.mock('#lib/components/charts/FuelEfficiencyTrendChart.svelte', () => ({ default: () => {} }));
vi.mock('#lib/components/vehicles/VehiclePhotoCarousel.svelte', () => ({ default: () => {} }));
vi.mock('#lib/components/vehicles/FinanceTab.svelte', () => ({ default: () => {} }));
vi.mock('#lib/components/vehicles/OdometerTab.svelte', () => ({ default: () => {} }));
vi.mock('#lib/components/vehicles/ShareVehicleDialog.svelte', () => ({ default: () => {} }));
vi.mock('#lib/components/vehicles/FuelEfficiencyStatsCard.svelte', () => ({ default: () => {} }));
vi.mock('#lib/components/common/MediaCaptureDialog.svelte', () => ({ default: () => {} }));
vi.mock('#lib/components/insurance/InsuranceTab.svelte', () => ({ default: () => {} }));

vi.mock('#lib/services/expense-api.ts', () => ({
	expenseApi: {
		getExpensesByVehicle: () => Promise.resolve({ data: [], pagination: { totalCount: 0 } }),
		getExpenseSummary: () =>
			Promise.resolve({
				totalAmount: 0,
				expenseCount: 0,
				recentAmount: 0,
				monthlyAverage: 0,
				categoryBreakdown: [],
				monthlyTrend: []
			})
	}
}));

const VEHICLE = {
	id: 'v1',
	userId: 'u1',
	make: 'Toyota',
	model: 'Camry',
	year: 2020,
	vehicleType: 'gas',
	nickname: 'Daily Driver',
	createdAt: '2024-01-01T00:00:00.000Z',
	updatedAt: '2024-01-01T00:00:00.000Z'
} as unknown as Vehicle;

const getVehicle = vi.fn();

vi.mock('#lib/services/vehicle-api.ts', () => ({
	vehicleApi: {
		getVehicle: (...args: unknown[]) => getVehicle(...args),
		getVehicleStats: () => Promise.resolve(null),
		getPhotos: () => Promise.resolve({ data: [] }),
		getPhotoThumbnailUrl: () => ''
	}
}));

const getFuelEfficiency = vi.fn();
vi.mock('#lib/services/analytics-api.ts', () => ({
	analyticsApi: { getFuelEfficiency: (...args: unknown[]) => getFuelEfficiency(...args) }
}));

const cachedVehicles = vi.fn<() => Vehicle[]>(() => []);
vi.mock('#lib/utils/offline-storage.ts', async importOriginal => ({
	...(await importOriginal<typeof import('#lib/utils/offline-storage.ts')>()),
	loadCachedVehicles: () => cachedVehicles()
}));

import Page from '../+page.svelte';
import { onlineStatus } from '#lib/stores/offline.svelte.ts';
import { appStore } from '#lib/stores/app.svelte.ts';

const offline = () => new NetworkError(new Error('Failed to fetch'));

beforeEach(() => {
	vi.clearAllMocks();
	onlineStatus.current = false;
	appStore.clearNotifications();
	cachedVehicles.mockReturnValue([VEHICLE]);
	getVehicle.mockRejectedValue(offline());
	getFuelEfficiency.mockRejectedValue(offline());
});

afterEach(() => {
	onlineStatus.current = true;
});

function renderPage() {
	return render(Page, { props: { data: { vehicleId: 'v1' } } });
}

describe('vehicle page offline', () => {
	test('shows the cached vehicle with an offline notice instead of the load error card', async () => {
		const screen = renderPage();

		expect(await screen.findByTestId('vehicle-offline-notice')).toHaveTextContent("You're offline");
		expect(screen.getByRole('heading', { level: 1, name: /Daily Driver/ })).toBeInTheDocument();
		expect(screen.queryByText("Couldn't load this vehicle")).not.toBeInTheDocument();
		expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
		expect(screen.queryByRole('tab', { name: 'Overview' })).not.toBeInTheDocument();
		expect(screen.getByTestId('vehicle-offline-notice')).toHaveTextContent(
			'Expenses you add while offline sync when you reconnect.'
		);
		expect(screen.queryByRole('link', { name: /Edit/ })).not.toBeInTheDocument();
		expect(screen.queryByRole('button', { name: 'Share' })).not.toBeInTheDocument();
		await new Promise(resolve => setTimeout(resolve, 0));
		expect(appStore.notifications.filter(n => n.type === 'error')).toEqual([]);
	});

	test('loads the full page once the connection comes back', async () => {
		const screen = renderPage();
		await screen.findByTestId('vehicle-offline-notice');
		getVehicle.mockResolvedValue(VEHICLE);
		getFuelEfficiency.mockResolvedValue({ fuelEfficiencyTrend: [] });

		onlineStatus.current = true;

		await waitFor(() => expect(screen.getByRole('tab', { name: 'Overview' })).toBeInTheDocument());
		expect(screen.queryByTestId('vehicle-offline-notice')).not.toBeInTheDocument();
		expect(getVehicle).toHaveBeenCalledTimes(2);
	});

	test('a vehicle that was never cached still shows the load error with Retry', async () => {
		cachedVehicles.mockReturnValue([]);

		const screen = renderPage();

		expect(await screen.findByRole('button', { name: 'Retry' })).toBeInTheDocument();
		expect(screen.getByText("Couldn't load this vehicle")).toBeInTheDocument();
		expect(screen.queryByTestId('vehicle-offline-notice')).not.toBeInTheDocument();
	});

	test('online, a network failure is not replaced by the cached copy', async () => {
		onlineStatus.current = true;

		const screen = renderPage();

		expect(await screen.findByRole('button', { name: 'Retry' })).toBeInTheDocument();
		expect(screen.queryByTestId('vehicle-offline-notice')).not.toBeInTheDocument();
	});
});
