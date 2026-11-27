import { beforeEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import type { AnalyticsQueryParams } from '#lib/types/index.ts';

const api = vi.hoisted(() => ({
	getVehicleHealth: vi.fn(),
	getVehicleTCO: vi.fn(),
	getVehicleExpenses: vi.fn(),
	query: vi.fn()
}));

vi.mock('$app/paths', () => ({ resolve: (path: string) => path }));
vi.mock('#lib/components/charts/index.ts', () => ({ AppBarChart: () => {} }));
vi.mock('#lib/services/vehicle-api.ts', () => ({
	vehicleApi: {
		getVehicles: () =>
			Promise.resolve([
				{ id: 'civic', year: 2019, make: 'Honda', model: 'Civic' },
				{ id: 'rav4', year: 2022, make: 'Toyota', model: 'RAV4', nickname: 'Daily Driver' }
			])
	}
}));
vi.mock('#lib/services/analytics-api.ts', () => ({
	analyticsApi: api,
	getDefaultDateRange: () => ({ startDate: 1, endDate: 2, ytdStart: 1 })
}));

import PerVehicleTab from '../PerVehicleTab.svelte';

const one = (value: number) => ({ series: [{ key: 'total', label: 'Cost', values: [value] }] });

function respond(params: AnalyticsQueryParams) {
	if (params.groupBy === 'category') {
		return {
			series: [
				{ key: 'financial', label: 'Financial', values: [7800] },
				{ key: 'fuel', label: 'Fuel', values: [1500] },
				{ key: 'maintenance', label: 'Maintenance', values: [700] }
			]
		};
	}
	if (params.metric === 'costPerDistance') return one(params.include === 'all' ? 0.9 : 0.25);
	return {
		buckets: ['2026-01', '2026-02'],
		series: [{ key: 'total', label: 'Cost', values: [100, 300] }],
		totals: { value: 400, perBucket: 200, perDistance: 0.2, distance: 2000 }
	};
}

const RANGE = { startDate: 100, endDate: 200, ytdStart: 50 };
const lifetimeCalls = () =>
	api.query.mock.calls.filter(([p]) => (p as AnalyticsQueryParams).interval === 'none');

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
		totalCost: 10000,
		costPerDistance: 0.9,
		costPerMonth: 300,
		totalDistance: 11000
	});
	api.getVehicleExpenses.mockResolvedValue({
		expenseBreakdown: [{ category: 'fuel', amount: 40 }]
	});
	api.query.mockImplementation((p: AnalyticsQueryParams) => Promise.resolve(respond(p)));
});

describe('PerVehicleTab', () => {
	test('starts on the first filtered car and asks for that car over the date range', async () => {
		render(PerVehicleTab, { dateRange: RANGE, preferredVehicleId: 'rav4' });
		expect(await screen.findByRole('button', { name: 'Daily Driver', pressed: true })).toBeTruthy();
		expect(screen.getByRole('button', { name: '2019 Honda Civic', pressed: false })).toBeTruthy();
		await waitFor(() => expect(api.getVehicleExpenses).toHaveBeenCalledWith('rav4', RANGE));
		expect(api.query).toHaveBeenCalledWith(
			expect.objectContaining({ vehicleIds: ['rav4'], interval: 'month', start: 100, end: 200 })
		);
		expect(lifetimeCalls().every(([p]) => (p as AnalyticsQueryParams).start === undefined)).toBe(
			true
		);
	});

	test('the hero names the total, the biggest share and the running costs', async () => {
		render(PerVehicleTab, { preferredVehicleId: 'rav4', rangeText: 'Last 12 months' });
		const hero = await screen.findByRole('heading', { level: 2, name: /Daily Driver, all time/ });
		expect(hero.textContent).toContain('$10,000');
		expect(screen.getByText(/78% of it went on loan and insurance payments\./).textContent).toMatch(
			/Running costs were\s+\$2,200\./
		);
		const list = screen.getByRole('list', { name: 'Where the money went, all time' });
		expect(list.textContent).toMatch(/Financial.*\$7,800.*Fuel.*\$1,500.*Maintenance.*\$700/s);
		const rates = screen.getByRole('heading', { name: 'Cost per mile' }).nextElementSibling;
		expect(rates?.textContent).toMatch(/All in, lifetime\s*\$0\.90\/mi/);
		expect(rates?.textContent).toMatch(/Running, lifetime\s*\$0\.25\/mi/);
		expect(rates?.textContent).toMatch(/Running, last 12 months\s*\$0\.20\/mi/);
	});

	test('a shared car whose financials are hidden shows no loan amounts or wording', async () => {
		render(PerVehicleTab, { preferredVehicleId: 'rav4', hiddenFinancials: new Set(['rav4']) });
		const hero = await screen.findByRole('heading', { level: 2, name: /Daily Driver, all time/ });
		expect(hero.textContent).toContain('$2,200');
		const page = document.body.textContent ?? '';
		expect(page).not.toMatch(/7,800|10,000|loan|All in|Financial/);
		expect(screen.getByText(/68% of it went on fuel and charging\./)).toBeTruthy();
	});

	test('a new date range re-sends only the range requests', async () => {
		const { rerender } = render(PerVehicleTab, { dateRange: RANGE, preferredVehicleId: 'rav4' });
		await screen.findByRole('heading', { level: 2, name: /Daily Driver, all time/ });
		expect(lifetimeCalls()).toHaveLength(3);

		await rerender({ dateRange: { ...RANGE, startDate: 150 }, preferredVehicleId: 'rav4' });
		await waitFor(() => expect(api.getVehicleExpenses).toHaveBeenCalledTimes(2));
		expect(api.query).toHaveBeenLastCalledWith(expect.objectContaining({ start: 150 }));
		expect(lifetimeCalls()).toHaveLength(3);
		expect(api.getVehicleHealth).toHaveBeenCalledTimes(1);
		expect(api.getVehicleTCO).toHaveBeenCalledTimes(1);
	});

	test('a lifetime query that failed is sent again on the next range change', async () => {
		api.query.mockImplementationOnce(() => Promise.reject(new Error('offline')));
		const { rerender } = render(PerVehicleTab, { dateRange: RANGE, preferredVehicleId: 'rav4' });
		await screen.findByRole('heading', { level: 2, name: /Daily Driver, all time/ });

		await rerender({ dateRange: { ...RANGE, startDate: 150 }, preferredVehicleId: 'rav4' });
		await waitFor(() => expect(lifetimeCalls()).toHaveLength(6));
		expect(api.getVehicleHealth).toHaveBeenCalledTimes(2);
	});

	test('picking another car loads that car', async () => {
		render(PerVehicleTab, { preferredVehicleId: 'rav4' });
		await fireEvent.click(await screen.findByRole('button', { name: '2019 Honda Civic' }));
		expect(
			await screen.findByRole('heading', { level: 2, name: /2019 Honda Civic, all time/ })
		).toBeTruthy();
		expect(api.getVehicleHealth).toHaveBeenLastCalledWith('civic');
		expect(screen.getByRole('button', { name: '2019 Honda Civic', pressed: true })).toBeTruthy();
	});

	test('a filter with no expenses names the filter and offers Clear filters', async () => {
		api.getVehicleExpenses.mockResolvedValue({ expenseBreakdown: [] });
		api.query.mockImplementation((p: AnalyticsQueryParams) =>
			Promise.resolve(
				p.interval === 'month'
					? {
							buckets: ['2026-01'],
							series: [{ key: 'total', label: 'Cost', values: [0] }],
							totals: { value: 0, perBucket: 0, perDistance: null, distance: 0 }
						}
					: respond(p)
			)
		);
		const onClearFilters = vi.fn();
		render(PerVehicleTab, { filterLabel: 'last 3 months, 1 car', onClearFilters });
		expect(
			await screen.findByRole('heading', { level: 2, name: 'No expenses for last 3 months, 1 car' })
		).toBeTruthy();
		expect(screen.getByText(/cover this car's whole history/)).toBeTruthy();
		await fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
		expect(onClearFilters).toHaveBeenCalledOnce();
	});
});
