import { beforeEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, render, waitFor } from '@testing-library/svelte';
import type { Vehicle } from '#lib/types/index.ts';
import { ApiError, NetworkError } from '#lib/utils/error-handling.ts';

const goto = vi.fn((_url: string) => Promise.resolve());
vi.mock('$app/navigation', () => ({ goto: (url: string) => goto(url) }));
vi.mock('$app/paths', () => ({ resolve: (path: string) => path }));

vi.mock('#lib/components/expenses/ExpensesTable.svelte', () => ({ default: () => {} }));
vi.mock('#lib/components/charts/index.ts', () => ({ AppBarChart: () => {} }));
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

vi.mock('#lib/services/analytics-api.ts', () => ({
	analyticsApi: { getFuelEfficiency: () => Promise.resolve({ fuelEfficiencyTrend: [] }) }
}));

import Page from '../+page.svelte';

beforeEach(() => {
	vi.clearAllMocks();
});

function renderPage() {
	return render(Page, { props: { data: { vehicleId: 'v1' } } });
}

describe('vehicle page — a failed vehicle load', () => {
	test.each([
		['a 404', new ApiError('Vehicle not found', 404)],
		['a malformed id (400)', new ApiError('Invalid vehicle id', 400)]
	])('%s sends the user back to the dashboard without a dead-end Retry', async (_label, error) => {
		getVehicle.mockRejectedValue(error);

		const screen = renderPage();

		await waitFor(() => expect(goto).toHaveBeenCalledWith('/dashboard'));
		expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
	});

	test.each([
		[
			'a server error',
			new ApiError('Internal server error', 500),
			'Something went wrong on our side. Try again in a moment.'
		],
		[
			'a network failure',
			new NetworkError(new Error('Failed to fetch')),
			'Check your connection and try again.'
		]
	])('%s keeps the user on the page with a Retry that reloads it', async (_label, error, hint) => {
		getVehicle.mockRejectedValueOnce(error).mockResolvedValueOnce(VEHICLE);

		const screen = renderPage();

		const retry = await screen.findByRole('button', { name: 'Retry' });
		expect(screen.getByText("Couldn't load this vehicle")).toBeInTheDocument();
		expect(screen.getByText(hint)).toBeInTheDocument();
		expect(screen.queryByText('Internal server error')).not.toBeInTheDocument();
		expect(goto).not.toHaveBeenCalled();

		await fireEvent.click(retry);

		await waitFor(() => expect(screen.getByRole('tab', { name: 'Overview' })).toBeInTheDocument());
		expect(getVehicle).toHaveBeenCalledTimes(2);
		expect(screen.queryByText("Couldn't load this vehicle")).not.toBeInTheDocument();
		expect(goto).not.toHaveBeenCalled();
	});
});
