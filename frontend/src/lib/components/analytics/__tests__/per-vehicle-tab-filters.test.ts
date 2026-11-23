import { beforeEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';

const api = vi.hoisted(() => ({
	getVehicleHealth: vi.fn(),
	getVehicleTCO: vi.fn(),
	getVehicleExpenses: vi.fn()
}));

vi.mock('$app/paths', () => ({ resolve: (path: string) => path }));
vi.mock('#lib/components/charts/index.ts', () => ({ AppPieChart: () => {} }));
vi.mock('#lib/services/vehicle-api.ts', () => ({
	vehicleApi: {
		getVehicles: () =>
			Promise.resolve([
				{ id: 'civic', year: 2019, make: 'Honda', model: 'Civic' },
				{ id: 'rav4', year: 2022, make: 'Toyota', model: 'RAV4' }
			])
	}
}));
vi.mock('#lib/services/analytics-api.ts', () => ({
	analyticsApi: api,
	getDefaultDateRange: () => ({ startDate: 1, endDate: 2, ytdStart: 1 })
}));

import PerVehicleTab from '../PerVehicleTab.svelte';

beforeEach(() => {
	vi.clearAllMocks();
	api.getVehicleHealth.mockResolvedValue({
		vehicleName: 'Toyota RAV4',
		overallScore: 50,
		maintenanceRegularity: 50,
		mileageIntervalAdherence: 50,
		insuranceCoverage: 50
	});
	api.getVehicleTCO.mockResolvedValue({
		totalCost: 0,
		costPerDistance: null,
		costPerMonth: 0,
		totalDistance: 0
	});
	api.getVehicleExpenses.mockResolvedValue({ expenseBreakdown: [] });
});

describe('PerVehicleTab with the page filters', () => {
	test('starts on the first filtered car and uses the date range', async () => {
		render(PerVehicleTab, {
			dateRange: { startDate: 100, endDate: 200, ytdStart: 50 },
			preferredVehicleId: 'rav4'
		});
		await waitFor(() => expect(api.getVehicleExpenses).toHaveBeenCalled());
		expect(api.getVehicleExpenses).toHaveBeenCalledWith('rav4', {
			startDate: 100,
			endDate: 200,
			ytdStart: 50
		});
	});

	test('a filter with no expenses names the filter and offers Clear filters', async () => {
		const onClearFilters = vi.fn();
		render(PerVehicleTab, { filterLabel: 'last 3 months, 1 car', onClearFilters });
		expect(await screen.findByText('No expenses for last 3 months, 1 car')).toBeTruthy();
		expect(screen.getByText(/cover this car's whole history/)).toBeTruthy();
		await fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
		expect(onClearFilters).toHaveBeenCalledOnce();
	});
});
