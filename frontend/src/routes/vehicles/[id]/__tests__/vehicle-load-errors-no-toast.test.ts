import { beforeEach, describe, expect, test, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/svelte';
import type { Vehicle } from '#lib/types/index.ts';
import { appStore } from '#lib/stores/app.svelte.ts';
import { ApiError } from '#lib/utils/error-handling.ts';

vi.mock('$app/navigation', () => ({ goto: vi.fn(() => Promise.resolve()) }));
vi.mock('$app/paths', () => ({ resolve: (path: string) => path }));

vi.mock('#lib/components/expenses/ExpensesTable.svelte', () => ({ default: () => {} }));
vi.mock('#lib/components/charts/index.ts', () => ({ AppBarChart: () => {} }));
vi.mock('#lib/components/charts/ExpenseTrendChart.svelte', () => ({ default: () => {} }));
vi.mock('#lib/components/charts/FuelEfficiencyTrendChart.svelte', () => ({ default: () => {} }));
vi.mock('#lib/components/vehicles/VehiclePhotoCarousel.svelte', () => ({ default: () => {} }));
vi.mock('#lib/components/vehicles/FinanceTab.svelte', () => ({ default: () => {} }));
vi.mock('#lib/components/vehicles/OdometerTab.svelte', () => ({ default: () => {} }));
vi.mock('#lib/components/vehicles/FuelEfficiencyStatsCard.svelte', () => ({ default: () => {} }));
vi.mock('#lib/components/common/MediaCaptureDialog.svelte', () => ({ default: () => {} }));
vi.mock('#lib/components/insurance/InsuranceTab.svelte', () => ({ default: () => {} }));

const serverDown = vi.hoisted(
	() => (): Promise<never> => Promise.reject(new Error('Request failed with status 500'))
);

const getExpenseSummary = vi.fn(serverDown);
vi.mock('#lib/services/expense-api.ts', () => ({
	expenseApi: {
		getExpensesByVehicle: serverDown,
		getExpenseSummary: () => getExpenseSummary()
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

const getVehicle = vi.fn<() => Promise<Vehicle>>(serverDown);
const getVehicleStats = vi.fn<() => Promise<unknown>>(serverDown);
vi.mock('#lib/services/vehicle-api.ts', () => ({
	vehicleApi: {
		getVehicle: () => getVehicle(),
		getVehicleStats: () => getVehicleStats(),
		getPhotos: serverDown,
		getPhotoThumbnailUrl: () => ''
	}
}));

vi.mock('#lib/services/analytics-api.ts', () => ({
	analyticsApi: { getFuelEfficiency: serverDown }
}));

import Page from '../+page.svelte';

function errorToasts() {
	return appStore.notifications.filter(n => n.type === 'error').map(n => n.message);
}

beforeEach(() => {
	appStore.clearNotifications();
	getVehicle.mockImplementation(serverDown);
	getExpenseSummary.mockImplementation(serverDown);
	getVehicleStats.mockImplementation(serverDown);
});

describe('vehicle page load failures show once, inline', () => {
	test('with the API down the page shows its error card and raises no toasts', async () => {
		render(Page, { props: { data: { vehicleId: 'v1' } } });

		expect(await screen.findByText("Couldn't load this vehicle")).toBeInTheDocument();
		await new Promise(resolve => setTimeout(resolve, 50));
		expect(errorToasts()).toEqual([]);
	});

	test('side loads that fail before the vehicle request settles raise no toast', async () => {
		getVehicle.mockImplementation(
			() =>
				new Promise((_, reject) =>
					setTimeout(() => reject(new Error('Request failed with status 500')), 30)
				)
		);
		render(Page, { props: { data: { vehicleId: 'v1' } } });

		expect(await screen.findByText("Couldn't load this vehicle")).toBeInTheDocument();
		await new Promise(resolve => setTimeout(resolve, 50));
		expect(errorToasts()).toEqual([]);
	});

	test('a side load that fails before a slower vehicle request succeeds still toasts', async () => {
		getVehicle.mockImplementation(
			() => new Promise(resolve => setTimeout(() => resolve(VEHICLE), 30))
		);
		render(Page, { props: { data: { vehicleId: 'v1' } } });

		await waitFor(() =>
			expect(errorToasts().some(m => m.startsWith("Couldn't load fuel efficiency"))).toBe(true)
		);
	});

	test('an unknown vehicle raises its one redirect toast, not one per side load', async () => {
		getVehicle.mockImplementation(() => Promise.reject(new ApiError('Vehicle not found', 404)));
		render(Page, { props: { data: { vehicleId: 'v1' } } });

		await waitFor(() => expect(errorToasts()).toHaveLength(1));
		await new Promise(resolve => setTimeout(resolve, 50));
		expect(errorToasts()).toHaveLength(1);
		expect(errorToasts()[0]).toMatch(/^Couldn't load this vehicle/);
	});

	test('a summary failure under a loaded vehicle shows its inline card without a toast', async () => {
		getVehicle.mockImplementation(() => Promise.resolve(VEHICLE));
		getVehicleStats.mockImplementation(() => Promise.resolve(null));
		render(Page, { props: { data: { vehicleId: 'v1' } } });

		expect(await screen.findByText("Couldn't load the expense summary")).toBeInTheDocument();
		await waitFor(() =>
			expect(errorToasts().some(m => m.startsWith("Couldn't load the expense summary"))).toBe(false)
		);
	});

	test('a load with no place on screen still toasts once the vehicle is there', async () => {
		getVehicle.mockImplementation(() => Promise.resolve(VEHICLE));
		render(Page, { props: { data: { vehicleId: 'v1' } } });

		await waitFor(() =>
			expect(errorToasts().some(m => m.startsWith("Couldn't load fuel efficiency"))).toBe(true)
		);
	});
});
