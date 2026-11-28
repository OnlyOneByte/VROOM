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
type ChartProps = {
	title?: string;
	data?: unknown;
	xAxisProps?: unknown;
	tooltipFormat?: (v: unknown) => string;
};
const charts = vi.hoisted(() => [] as ChartProps[]);
vi.mock('#lib/components/charts/index.ts', () => ({
	AppBarChart: (_: unknown, props: ChartProps) => {
		charts.push(props);
	}
}));
const chart = (title: string) => charts.findLast(c => c.title === title);
const getVehicles = vi.hoisted(() =>
	vi.fn((_opts?: { includeShared?: boolean }) =>
		Promise.resolve([
			{ id: 'civic', year: 2019, make: 'Honda', model: 'Civic' },
			{ id: 'rav4', year: 2022, make: 'Toyota', model: 'RAV4', nickname: 'Daily Driver' },
			{
				id: 'shared',
				year: 2021,
				make: 'Ford',
				model: 'F-150',
				sharedAccess: { seesFinancials: false }
			},
			{
				id: 'open',
				year: 2018,
				make: 'Mazda',
				model: 'CX-5',
				sharedAccess: { seesFinancials: true }
			},
			{
				id: 'euro',
				year: 2017,
				make: 'VW',
				model: 'Golf',
				ownerCurrency: 'EUR',
				sharedAccess: { seesFinancials: true }
			},
			{
				id: 'yen',
				year: 2016,
				make: 'Mazda',
				model: 'Demio',
				ownerCurrency: 'JPY',
				sharedAccess: { seesFinancials: true }
			}
		])
	)
);
vi.mock('#lib/services/vehicle-api.ts', () => ({ vehicleApi: { getVehicles } }));
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

async function findHero(name: string) {
	const label = await screen.findByText(`${name}, all time`);
	return label.closest('[data-slot="hero-figure"]') as HTMLElement;
}

beforeEach(() => {
	vi.clearAllMocks();
	charts.length = 0;
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
		const hero = await findHero('Daily Driver');
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

	test('the monthly chart labels its months on the x-axis', async () => {
		render(PerVehicleTab, { preferredVehicleId: 'rav4' });
		await findHero('Daily Driver');
		const axis = chart('Spend by month, running only')?.xAxisProps as {
			ticks: string[];
			format: (v: unknown) => string;
		};
		expect(axis.ticks).toEqual(['Jan ’26', 'Feb ’26']);
		expect(axis.format('Jan ’26')).toBe('Jan ’26');
	});

	test('loads cars shared with you along with your own', async () => {
		render(PerVehicleTab, { preferredVehicleId: 'rav4' });
		expect(await screen.findByRole('button', { name: '2021 Ford F-150' })).toBeTruthy();
		expect(getVehicles).toHaveBeenCalledWith({ includeShared: true });
	});

	test('a car shared with you gets the full overview, without the financial figures it hides', async () => {
		api.getVehicleExpenses.mockResolvedValue({
			expenseBreakdown: [
				{ category: 'financial', amount: 900 },
				{ category: 'fuel', amount: 40 }
			]
		});
		render(PerVehicleTab, { preferredVehicleId: 'shared', hiddenFinancials: new Set(['shared']) });
		const hero = await findHero('2021 Ford F-150');
		expect(hero.textContent).toContain('$2,200');
		expect(api.query).toHaveBeenCalledWith(expect.objectContaining({ vehicleIds: ['shared'] }));
		const page = document.body.textContent ?? '';
		expect(page).not.toMatch(
			/is shared with you|7,800|10,000|loan|All in|Financial|Total cost of ownership/
		);
		const breakdown = chart('Spending by category')?.data as Array<{ key: string }>;
		expect(breakdown.map(r => r.key)).toEqual(['fuel']);
	});

	test('a shared car kept in another currency gets its health and totals, not a summed overview', async () => {
		render(PerVehicleTab, { preferredVehicleId: 'euro' });
		expect(await screen.findByText(/2017 VW Golf is shared with you and kept in EUR/)).toBeTruthy();
		expect(screen.getByRole('heading', { level: 2, name: 'Vehicle health score' })).toBeTruthy();
		expect(api.query).not.toHaveBeenCalled();
		expect(document.body.textContent ?? '').not.toMatch(/all time|\$0(?![.\d])|Not enough data/);
	});

	test("a shared car's totals are in its owner's currency", async () => {
		render(PerVehicleTab, { preferredVehicleId: 'euro' });
		await screen.findByText(/2017 VW Golf is shared with you and kept in EUR/);
		const page = document.body.textContent ?? '';
		expect(page).toContain('€10,000.00');
		expect(page).toContain('€300.00');
		expect(page).not.toMatch(/\$10,000|\$300/);
		const spend = chart('Spending by category');
		const axis = spend?.xAxisProps as { format: (v: number) => string };
		expect(axis.format(1200)).toBe('€1,200');
		expect(spend?.tooltipFormat?.(40)).toBe('€40.00');
	});

	test("a shared car's totals use its owner's currency's minor units", async () => {
		api.getVehicleTCO.mockResolvedValue({
			totalCost: 1234567,
			costPerDistance: 12,
			costPerMonth: 30000,
			totalDistance: 11000
		});
		render(PerVehicleTab, { preferredVehicleId: 'yen' });
		await screen.findByText(/2016 Mazda Demio is shared with you and kept in JPY/);
		const page = document.body.textContent ?? '';
		expect(page).toMatch(/¥1,234,567(?![.\d])/);
		expect(page).toMatch(/¥30,000(?![.\d])/);
	});

	test('a car shared with full access shows its ownership totals and financial spend', async () => {
		api.getVehicleExpenses.mockResolvedValue({
			expenseBreakdown: [
				{ category: 'financial', amount: 900 },
				{ category: 'fuel', amount: 40 }
			]
		});
		render(PerVehicleTab, { preferredVehicleId: 'open' });
		const hero = await findHero('2018 Mazda CX-5');
		expect(hero.textContent).toContain('$10,000');
		expect(screen.getByText('Total cost of ownership')).toBeTruthy();
		const breakdown = chart('Spending by category')?.data as Array<{ key: string }>;
		expect(breakdown.map(r => r.key)).toEqual(['financial', 'fuel']);
	});

	test('a shared car with a filter and no expenses offers Clear filters', async () => {
		api.getVehicleExpenses.mockResolvedValue({ expenseBreakdown: [] });
		api.query.mockImplementation((p: AnalyticsQueryParams) =>
			Promise.resolve(
				p.interval === 'month'
					? {
							buckets: ['2026-01'],
							series: [{ key: 'total', label: 'Cost', values: [0] }],
							totals: {}
						}
					: respond(p)
			)
		);
		const onClearFilters = vi.fn();
		render(PerVehicleTab, {
			preferredVehicleId: 'shared',
			hiddenFinancials: new Set(['shared']),
			filterLabel: 'last 3 months, 1 car',
			onClearFilters
		});
		expect(
			await screen.findByRole('heading', { level: 2, name: 'No expenses for last 3 months, 1 car' })
		).toBeTruthy();
		await fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
		expect(onClearFilters).toHaveBeenCalledOnce();
	});

	test('a car whose financials are hidden shows no loan amounts or wording', async () => {
		api.getVehicleExpenses.mockResolvedValue({
			expenseBreakdown: [
				{ category: 'financial', amount: 900 },
				{ category: 'fuel', amount: 40 }
			]
		});
		render(PerVehicleTab, { preferredVehicleId: 'rav4', hiddenFinancials: new Set(['rav4']) });
		const hero = await findHero('Daily Driver');
		expect(hero.textContent).toContain('$2,200');
		const page = document.body.textContent ?? '';
		expect(page).not.toMatch(/7,800|10,000|loan|All in|Financial/);
		expect(screen.getByText(/68% of it went on fuel and charging\./)).toBeTruthy();
		const breakdown = chart('Spending by category')?.data as Array<{ key: string }>;
		expect(breakdown.map(r => r.key)).toEqual(['fuel']);
	});

	test('a new date range re-sends only the range requests', async () => {
		const { rerender } = render(PerVehicleTab, { dateRange: RANGE, preferredVehicleId: 'rav4' });
		await findHero('Daily Driver');
		expect(lifetimeCalls()).toHaveLength(3);

		await rerender({ dateRange: { ...RANGE, startDate: 150 }, preferredVehicleId: 'rav4' });
		await waitFor(() => expect(api.getVehicleExpenses).toHaveBeenCalledTimes(2));
		expect(api.query).toHaveBeenLastCalledWith(expect.objectContaining({ start: 150 }));
		expect(lifetimeCalls()).toHaveLength(3);
		expect(api.getVehicleHealth).toHaveBeenCalledTimes(1);
		expect(api.getVehicleTCO).toHaveBeenCalledTimes(1);
	});

	test('a failed query shows the error card, and Retry loads everything again', async () => {
		api.query.mockImplementationOnce(() => Promise.reject(new Error('offline')));
		render(PerVehicleTab, { dateRange: RANGE, preferredVehicleId: 'rav4' });
		expect(await screen.findByText("Couldn't load vehicle analytics")).toBeTruthy();
		expect(screen.queryByText(/all time/)).toBeNull();

		await fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
		const hero = await findHero('Daily Driver');
		expect(hero.textContent).toContain('$10,000');
		expect(lifetimeCalls()).toHaveLength(6);
		expect(api.getVehicleHealth).toHaveBeenCalledTimes(2);
	});

	test('picking another car loads that car', async () => {
		render(PerVehicleTab, { preferredVehicleId: 'rav4' });
		await fireEvent.click(await screen.findByRole('button', { name: '2019 Honda Civic' }));
		expect(await findHero('2019 Honda Civic')).toBeTruthy();
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
