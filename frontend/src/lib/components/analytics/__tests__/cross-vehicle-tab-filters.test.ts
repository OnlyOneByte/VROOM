import { beforeEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';

const api = vi.hoisted(() => ({
	getCrossVehicle: vi.fn(),
	getFinancing: vi.fn(),
	getInsurance: vi.fn(),
	query: vi.fn((): Promise<unknown> => Promise.resolve({ series: [] }))
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
		expect(
			await screen.findByRole('heading', {
				level: 2,
				name: 'No expenses for year to date, all cars'
			})
		).toBeTruthy();
		expect(screen.queryByText('More detail')).toBeNull();
		await fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
		expect(onClearFilters).toHaveBeenCalledOnce();
	});

	test('a new date range re-sends only the range queries, not the lifetime ones', async () => {
		const { rerender } = render(CrossVehicleTab, {
			dateRange: { startDate: 100, endDate: 200, ytdStart: 50 },
			vehicleIds: ['civic']
		});
		await waitFor(() => expect(api.query).toHaveBeenCalledTimes(8));
		await screen.findByLabelText('Cross-vehicle overview');

		await rerender({
			dateRange: { startDate: 150, endDate: 250, ytdStart: 50 },
			vehicleIds: ['civic']
		});
		await waitFor(() => expect(api.getCrossVehicle).toHaveBeenCalledTimes(2));
		expect(api.query).toHaveBeenCalledTimes(9);
		expect(api.query).toHaveBeenLastCalledWith(
			expect.objectContaining({ include: 'running', start: 150, end: 250 })
		);
		expect(api.getFinancing).toHaveBeenCalledTimes(1);
		expect(api.getInsurance).toHaveBeenCalledTimes(1);

		await rerender({
			dateRange: { startDate: 150, endDate: 250, ytdStart: 50 },
			vehicleIds: ['rav4']
		});
		await waitFor(() => expect(api.query).toHaveBeenCalledTimes(17));
		expect(api.getFinancing).toHaveBeenCalledTimes(2);
	});

	test('a lifetime query that failed is sent again on the next range change', async () => {
		api.query.mockImplementationOnce(() => Promise.resolve(null));
		api.query.mockImplementationOnce(() => Promise.reject(new Error('offline')));
		const { rerender } = render(CrossVehicleTab, {
			dateRange: { startDate: 100, endDate: 200, ytdStart: 50 }
		});
		await screen.findByLabelText('Cross-vehicle overview');
		expect(api.query).toHaveBeenCalledTimes(8);

		await rerender({ dateRange: { startDate: 150, endDate: 250, ytdStart: 50 } });
		await waitFor(() => expect(api.query).toHaveBeenCalledTimes(16));
		expect(api.getFinancing).toHaveBeenCalledTimes(2);
	});

	test('after a failed load, Retry fetches the lifetime data again', async () => {
		api.getFinancing.mockRejectedValueOnce(new Error('offline'));
		render(CrossVehicleTab);
		await fireEvent.click(await screen.findByRole('button', { name: /retry/i }));
		await screen.findByLabelText('Cross-vehicle overview');
		expect(api.getFinancing).toHaveBeenCalledTimes(2);
		expect(api.query).toHaveBeenCalledTimes(16);
	});

	test('without a filter an empty account shows no filter message', async () => {
		render(CrossVehicleTab);
		await waitFor(() => expect(api.getCrossVehicle).toHaveBeenCalled());
		expect(screen.queryByText(/No expenses for/)).toBeNull();
	});
});
