import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import type { AnalyticsQueryCoverage, AnalyticsQueryParams } from '#lib/types/index.ts';

const api = vi.hoisted(() => ({ query: vi.fn(), queryItems: vi.fn() }));
const getVehicles = vi.hoisted(() => vi.fn());
type ChartProps = { title?: string; data?: unknown; xAxisProps?: unknown };
const charts = vi.hoisted(() => [] as ChartProps[]);

vi.mock('#lib/components/charts/index.ts', () => ({
	AppBarChart: (_: unknown, props: ChartProps) => {
		charts.push(props);
	},
	AppLineChart: (_: unknown, props: ChartProps) => {
		charts.push(props);
	}
}));
vi.mock('#lib/services/analytics-api.ts', () => ({ analyticsApi: api }));
vi.mock('#lib/services/vehicle-api.ts', () => ({ vehicleApi: { getVehicles } }));

import YearEndTab from '../YearEndTab.svelte';

const one = (key: string, value: number) => ({ key, label: key, values: [value] });
const secs = (d: Date) => Math.floor(d.getTime() / 1000);

let coverage: AnalyticsQueryCoverage;
const covering = (vehicleIds: string[], otherCurrency: string[] = []) => ({
	vehicleIds,
	otherCurrency: otherCurrency.map((currency, i) => ({ vehicleId: `other-${i}`, currency })),
	unavailable: 0
});

function respond(p: AnalyticsQueryParams) {
	if (p.metric === 'cost' && p.interval === 'month') {
		return {
			buckets: ['2026-01', '2026-02', '2026-03'],
			series: [{ key: 'total', label: 'Cost', values: [1000, 3055, 500] }],
			totals: { value: 4555, perBucket: 1518, perDistance: 0.5, distance: 9110 },
			unit: 'USD',
			coverage
		};
	}
	if (p.metric === 'cost' && p.groupBy === 'category') {
		return {
			series: [one('financial', 3000), one('fuel', 1055), one('maintenance', 500)],
			totals: { value: 4555 }
		};
	}
	if (p.metric === 'cost') return { series: [], totals: { value: 4141 } };
	if (p.metric === 'count' && p.groupBy === 'category') {
		return { series: [one('fuel', 90), one('maintenance', 20), one('misc', 13)], totals: {} };
	}
	if (p.metric === 'count') return { series: [one('Daily Driver', 36)], totals: {} };
	if (p.metric === 'costPerDistance') {
		return { series: [one('Sparky', 0.09), one('Daily Driver', 0.14)], totals: {} };
	}
	return {
		buckets: ['2026-01', '2026-02', '2026-03'],
		series: [{ key: 'total', label: 'mpg', values: [30, 32, null] }],
		totals: { value: 31 }
	};
}

const ITEMS = {
	total: 4555,
	count: 123,
	fuel: { total: 1055, count: 90 },
	items: [
		{
			id: 'e1',
			date: secs(new Date(2026, 1, 10, 12)),
			category: 'financial',
			vehicleId: 'civic',
			vehicleName: 'Civic',
			description: 'Insurance',
			amount: 1200
		}
	],
	others: null,
	categories: []
};

const chart = (title: RegExp) => charts.findLast(c => title.test(c.title ?? ''));
const text = () => (document.body.textContent ?? '').replace(/\s+/g, ' ');

beforeEach(() => {
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(new Date(2026, 10, 27, 12));
	vi.clearAllMocks();
	charts.length = 0;
	coverage = covering(['civic', 'rav4', 'f150']);
	api.queryItems.mockResolvedValue(ITEMS);
	api.query.mockImplementation((p: AnalyticsQueryParams) => Promise.resolve(respond(p)));
});

afterEach(() => {
	vi.useRealTimers();
});

describe('YearEndTab', () => {
	test('the hero, the category bars and the monthly chart tell the same total', async () => {
		render(YearEndTab);
		const label = await screen.findByText('2026 so far · 3 vehicles');
		expect(label.parentElement?.parentElement?.textContent).toContain('$4,555');
		const bars = screen.getByRole('list', { name: 'Where it went, 2026' });
		expect(bars.textContent).toMatch(/Financial.*\$3,000.*Fuel.*\$1,055.*Maintenance.*\$500/s);
		const months = chart(/All-in spend by month/)?.data as Array<{ value: number }>;
		expect(months.reduce((sum, m) => sum + m.value, 0)).toBe(4555);
		expect(text()).not.toMatch(/shared with you/);
	});

	test('the summary counts, names the biggest month and compares with the same point last year', async () => {
		render(YearEndTab);
		await screen.findByText('2026 so far · 3 vehicles');
		expect(text()).toContain(
			'Across 123 expenses and 90 fill-ups and charges. The biggest month was February ($3,055).'
		);
		expect(text()).toContain("That's 10% more than the same point in 2025.");
		const previous = api.query.mock.calls
			.map(([p]) => p as AnalyticsQueryParams)
			.find(p => p.metric === 'cost' && p.interval === 'none' && !p.groupBy);
		expect(previous).toMatchObject({
			start: secs(new Date(2025, 0, 1)),
			end: secs(new Date(2025, 10, 28))
		});
	});

	test('highlights name the cheapest car, the most fill-ups and the biggest expense', async () => {
		render(YearEndTab);
		const list = await screen.findByRole('list', { name: 'Highlights' });
		expect(list.textContent).toMatch(/Cheapest car to run\s*Sparky · \$0\.09\/mi/);
		expect(list.textContent).toMatch(/Most fill-ups and charges\s*Daily Driver · 36/);
		expect(list.textContent).toMatch(
			/Biggest single expense \(excluding fill-ups and charges\)\s*Insurance · \$1,200\.00 · Feb 10/
		);
		expect(api.queryItems).toHaveBeenCalledWith({
			start: secs(new Date(2026, 0, 1)),
			end: secs(new Date(2026, 10, 28)),
			include: 'all',
			metric: 'cost'
		});
	});

	test('the car count comes from the query, with no car list and no per-car query', async () => {
		render(YearEndTab);
		await screen.findByText('2026 so far · 3 vehicles');
		expect(getVehicles).not.toHaveBeenCalled();
		const perCar = api.query.mock.calls
			.map(([p]) => p as AnalyticsQueryParams)
			.filter(p => p.metric === 'cost' && p.groupBy === 'vehicle');
		expect(perCar).toEqual([]);
	});

	test('the Cars filter reaches every query, and the list of biggest expenses', async () => {
		render(YearEndTab, { props: { vehicleIds: ['civic'] } });
		await screen.findByText('2026 so far · 3 vehicles');
		const sent = api.query.mock.calls.map(([p]) => (p as AnalyticsQueryParams).vehicleIds);
		expect(sent).toHaveLength(7);
		expect(sent.every(ids => ids?.join() === 'civic')).toBe(true);
		expect(api.queryItems).toHaveBeenCalledWith(
			expect.objectContaining({ vehicleIds: ['civic'] })
		);
	});

	test('picking other cars reloads the year; the same cars again does not', async () => {
		const { rerender } = render(YearEndTab, { props: { vehicleIds: ['civic'] } });
		await screen.findByText('2026 so far · 3 vehicles');
		await rerender({ vehicleIds: ['civic'] });
		await new Promise(r => setTimeout(r, 20));
		expect(api.queryItems).toHaveBeenCalledTimes(1);
		await rerender({ vehicleIds: ['rav4', 'f150'] });
		await waitFor(() => expect(api.queryItems).toHaveBeenCalledTimes(2));
		expect(api.queryItems).toHaveBeenLastCalledWith(
			expect.objectContaining({ vehicleIds: ['rav4', 'f150'] })
		);
		await rerender({ vehicleIds: undefined });
		await waitFor(() => expect(api.queryItems).toHaveBeenCalledTimes(3));
		expect(api.queryItems.mock.calls[2]?.[0]).not.toHaveProperty('vehicleIds');
	});

	test('a covered car with no spending this year still counts', async () => {
		coverage = covering(['civic', 'rav4', 'f150', 'outback']);
		render(YearEndTab);
		expect(await screen.findByText('2026 so far · 4 vehicles')).toBeTruthy();
	});

	test('one covered car reads in the singular', async () => {
		coverage = covering(['civic']);
		render(YearEndTab);
		expect(await screen.findByText('2026 so far · 1 vehicle')).toBeTruthy();
	});

	test('a car left out for its currency gives the currency note', async () => {
		coverage = covering(['civic', 'rav4', 'f150'], ['EUR']);
		render(YearEndTab);
		await screen.findByText('2026 so far · 3 vehicles');
		expect(text()).toContain(
			'Not included: cars shared with you in EUR. These figures are in USD.'
		);
	});

	test('cars left out in several currencies read as a list, each currency once', async () => {
		coverage = covering(['civic'], ['EUR', 'GBP', 'EUR', 'CAD']);
		render(YearEndTab);
		await screen.findByText('2026 so far · 1 vehicle');
		expect(text()).toContain(
			'Not included: cars shared with you in EUR, GBP, and CAD. These figures are in USD.'
		);
	});

	test('cars the query could not cover for any other reason are not mentioned', async () => {
		coverage = { ...covering(['civic', 'rav4', 'f150']), unavailable: 2 };
		render(YearEndTab);
		await screen.findByText('2026 so far · 3 vehicles');
		expect(text()).not.toMatch(/Not included|shared with you|5 vehicles/);
	});

	test('the monthly chart labels each month; the fuel economy chart uses the query', async () => {
		render(YearEndTab);
		await screen.findByText('2026 so far · 3 vehicles');
		const axis = chart(/All-in spend by month/)?.xAxisProps as {
			ticks: string[];
			format: (v: unknown) => string;
		};
		expect(axis.ticks).toEqual(['Jan', 'Feb', 'Mar']);
		expect(axis.format('Feb')).toBe('Feb');
		const eff = chart(/by month$/)?.data as Array<{ efficiency: number }>;
		expect(eff.map(d => d.efficiency)).toEqual([30, 32]);
	});

	test('a year with no spending says so, and still shows the currency note', async () => {
		api.query.mockImplementation((p: AnalyticsQueryParams) =>
			Promise.resolve({
				buckets: [],
				series: [],
				totals: { value: 0 },
				metric: p.metric,
				unit: 'USD',
				coverage: covering([], ['EUR'])
			})
		);
		render(YearEndTab);
		expect(
			await screen.findByRole('heading', { level: 2, name: 'No expenses in 2026' })
		).toBeTruthy();
		expect(text()).toContain('Not included: cars shared with you in EUR.');
	});

	test('with cars picked, the empty year says those cars have no expenses', async () => {
		api.query.mockImplementation((p: AnalyticsQueryParams) =>
			Promise.resolve({ buckets: [], series: [], totals: { value: 0 }, metric: p.metric })
		);
		render(YearEndTab, { props: { vehicleIds: ['civic'] } });
		await screen.findByRole('heading', { level: 2, name: 'No expenses in 2026' });
		expect(text()).toContain(
			'The cars you picked have no expenses in 2026. Pick another year or other cars.'
		);
	});

	test('picking other cars after an error clears the error card while it loads', async () => {
		api.query.mockImplementationOnce(() => Promise.reject(new Error('offline')));
		const { rerender } = render(YearEndTab, { props: { vehicleIds: ['civic'] } });
		expect(await screen.findByText("Couldn't load year-end summary")).toBeTruthy();
		let release: (v: unknown) => void = () => {};
		api.queryItems.mockImplementationOnce(() => new Promise(r => (release = r)));
		await rerender({ vehicleIds: ['rav4'] });
		await waitFor(() => expect(screen.queryByText("Couldn't load year-end summary")).toBeNull());
		release(ITEMS);
		expect(await screen.findByText('2026 so far · 3 vehicles')).toBeTruthy();
	});

	test('a failed request shows the error card, and Retry loads the year again', async () => {
		api.query.mockImplementationOnce(() => Promise.reject(new Error('offline')));
		render(YearEndTab);
		expect(await screen.findByText("Couldn't load year-end summary")).toBeTruthy();
		await fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
		expect(await screen.findByText('2026 so far · 3 vehicles')).toBeTruthy();
		await waitFor(() => expect(api.queryItems).toHaveBeenCalledTimes(2));
	});

	test('a late answer for the year you left does not replace the year you picked', async () => {
		let releaseFirst: (v: unknown) => void = () => {};
		api.queryItems.mockImplementationOnce(() => new Promise(r => (releaseFirst = r)));
		api.query.mockImplementation((p: AnalyticsQueryParams) =>
			Promise.resolve(
				p.interval === 'month' && p.metric === 'cost' && p.start === secs(new Date(2025, 0, 1))
					? {
							buckets: ['2025-01'],
							series: [{ key: 'total', label: 'Cost', values: [2222] }],
							totals: { value: 2222, perBucket: 2222, perDistance: 0.4, distance: 5555 },
							coverage
						}
					: respond(p)
			)
		);
		render(YearEndTab);

		const trigger = screen.getByRole('combobox', { name: '2026, report year' });
		await fireEvent.pointerDown(trigger, { button: 0, pointerType: 'mouse' });
		await fireEvent.pointerUp(trigger, { button: 0, pointerType: 'mouse' });
		const option = await screen.findByRole('option', { name: '2025' });
		await fireEvent.pointerUp(option, { button: 0, pointerType: 'mouse' });
		await fireEvent.click(option);

		const label = await screen.findByText('2025 · 3 vehicles');
		const hero = () => label.parentElement?.parentElement?.textContent ?? '';
		expect(hero()).toContain('$2,222');
		releaseFirst(ITEMS);
		await new Promise(r => setTimeout(r, 20));
		expect(hero()).toContain('$2,222');
		expect(text()).not.toContain('$4,555');
	});
});
