import { beforeEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';

const api = vi.hoisted(() => ({
	getCrossVehicle: vi.fn(),
	getFinancing: vi.fn(),
	getInsurance: vi.fn(),
	query: vi.fn(() => Promise.resolve(null))
}));

vi.mock('#lib/components/charts/index.ts', () => ({
	AppBarChart: () => {},
	AppLineChart: () => {},
	AppPieChart: () => {}
}));
vi.mock('#lib/components/charts/ExpenseTrendChart.svelte', () => ({ default: () => {} }));
vi.mock('../cross-vehicle/FinancingAnalytics.svelte', () => ({ default: () => {} }));
vi.mock('../cross-vehicle/InsuranceAnalytics.svelte', () => ({ default: () => {} }));
vi.mock('#lib/services/analytics-api.ts', () => ({
	analyticsApi: api,
	getDefaultDateRange: () => ({ startDate: 10, endDate: 20, ytdStart: 5 })
}));

import CrossVehicleTab from '../CrossVehicleTab.svelte';

const EMPTY = {
	monthlyExpenseTrends: [],
	expenseByCategory: [],
	vehicleCostComparison: [],
	fuelEfficiencyComparison: [],
	units: { distanceUnit: 'miles', volumeUnit: 'gallons_us', chargeUnit: 'kwh' }
};

beforeEach(() => {
	vi.clearAllMocks();
	api.getCrossVehicle.mockResolvedValue(EMPTY);
	api.getFinancing.mockResolvedValue({});
	api.getInsurance.mockResolvedValue({});
});

describe('CrossVehicleTab with the page filters', () => {
	test('passes the range and cars to all three endpoints', async () => {
		render(CrossVehicleTab, {
			dateRange: { startDate: 100, endDate: 200, ytdStart: 50 },
			vehicleIds: ['civic']
		});
		await waitFor(() => expect(api.getCrossVehicle).toHaveBeenCalled());
		expect(api.getCrossVehicle).toHaveBeenCalledWith({
			startDate: 100,
			endDate: 200,
			ytdStart: 50,
			vehicleIds: ['civic']
		});
		expect(api.getFinancing).toHaveBeenCalledWith({ vehicleIds: ['civic'] });
		expect(api.getInsurance).toHaveBeenCalledWith({ vehicleIds: ['civic'] });
	});

	test('a filter with no expenses names the filter and offers Clear filters', async () => {
		const onClearFilters = vi.fn();
		render(CrossVehicleTab, { filterLabel: 'year to date, all cars', onClearFilters });
		expect(await screen.findByText('No expenses for year to date, all cars')).toBeTruthy();
		await fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
		expect(onClearFilters).toHaveBeenCalledOnce();
	});

	test('without a filter an empty account shows no filter message', async () => {
		render(CrossVehicleTab);
		await waitFor(() => expect(api.getCrossVehicle).toHaveBeenCalled());
		expect(screen.queryByText(/No expenses for/)).toBeNull();
	});
});
