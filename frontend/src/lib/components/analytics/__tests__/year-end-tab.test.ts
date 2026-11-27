import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import type { AnalyticsQueryParams } from '#lib/types/index.ts';

const api = vi.hoisted(() => ({ getYearEnd: vi.fn(), query: vi.fn() }));
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

const OWNED = [
	{ id: 'civic', year: 2019, make: 'Honda', model: 'Civic' },
	{ id: 'rav4', year: 2022, make: 'Toyota', model: 'RAV4' }
];
const SHARED = { id: 'f150', year: 2021, make: 'Ford', model: 'F-150', sharedAccess: {} };
const one = (key: string, value: number) => ({ key, label: key, values: [value] });

function respond(p: AnalyticsQueryParams) {
	if (p.metric === 'cost' && p.interval === 'month') {
		return {
			buckets: ['2026-01', '2026-02', '2026-03'],
			series: [{ key: 'total', label: 'Cost', values: [1000, 3055, 500] }],
			totals: { value: 4555, perBucket: 1518, perDistance: 0.5, distance: 9110 }
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

const chart = (title: RegExp) => charts.findLast(c => title.test(c.title ?? ''));
const text = () => (document.body.textContent ?? '').replace(/\s+/g, ' ');

beforeEach(() => {
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(new Date(2026, 10, 27, 12));
	vi.clearAllMocks();
	charts.length = 0;
	getVehicles.mockResolvedValue(OWNED);
	api.getYearEnd.mockResolvedValue({
		year: 2026,
		totalSpent: 99999,
		categoryBreakdown: [],
		efficiencyTrend: [],
		biggestExpense: { description: 'Insurance', amount: 1200, date: '2026-02-10T12:00:00Z' },
		previousYearComparison: null,
		vehicleCount: 7,
		totalDistance: 0,
		avgEfficiency: null,
		costPerDistance: null
	});
	api.query.mockImplementation((p: AnalyticsQueryParams) => Promise.resolve(respond(p)));
});

afterEach(() => {
	vi.useRealTimers();
});

describe('YearEndTab', () => {
	test('the hero, the category bars and the monthly chart tell the same total', async () => {
		render(YearEndTab);
		const label = await screen.findByText('2026 so far · 2 vehicles');
		expect(label.parentElement?.parentElement?.textContent).toContain('$4,555');
		const bars = screen.getByRole('list', { name: 'Where it went, 2026' });
		expect(bars.textContent).toMatch(/Financial.*\$3,000.*Fuel.*\$1,055.*Maintenance.*\$500/s);
		const months = chart(/All-in spend by month/)?.data as Array<{ value: number }>;
		expect(months.reduce((sum, m) => sum + m.value, 0)).toBe(4555);
		expect(text()).not.toMatch(/99,999|7 vehicles/);
	});

	test('the summary counts, names the biggest month and compares with the same point last year', async () => {
		render(YearEndTab);
		await screen.findByText('2026 so far · 2 vehicles');
		expect(text()).toContain(
			'Across 123 expenses and 90 fill-ups and charges. The biggest month was February ($3,055).'
		);
		expect(text()).toContain("That's 10% more than the same point in 2025.");
		const previous = api.query.mock.calls
			.map(([p]) => p as AnalyticsQueryParams)
			.find(p => p.metric === 'cost' && p.interval === 'none' && !p.groupBy);
		expect(previous).toMatchObject({
			start: Math.floor(new Date(2025, 0, 1).getTime() / 1000),
			end: Math.floor(new Date(2025, 10, 28).getTime() / 1000)
		});
	});

	test('highlights name the cheapest car, the most fill-ups and the biggest expense', async () => {
		render(YearEndTab);
		const list = await screen.findByRole('list', { name: 'Highlights' });
		expect(list.textContent).toMatch(/Cheapest car to run\s*Sparky · \$0\.09\/mi/);
		expect(list.textContent).toMatch(/Most fill-ups and charges\s*Daily Driver · 36/);
		expect(list.textContent).toMatch(/Biggest single expense\s*Insurance · \$1,200\.00 · Feb 10/);
	});

	test('with a car shared with you, every figure covers owned cars and says so', async () => {
		getVehicles.mockResolvedValue([...OWNED, SHARED]);
		render(YearEndTab);
		expect(await screen.findByText('2026 so far · 2 vehicles')).toBeTruthy();
		expect(text()).toContain(
			"These figures cover the 2 vehicles you own. Cars shared with you aren't included yet."
		);
		expect(text()).toContain('$4,555');
		expect(text()).not.toMatch(/99,999|Biggest single expense|Insurance/);
	});

	test('the monthly chart labels each month; the fuel economy chart uses the query', async () => {
		render(YearEndTab);
		await screen.findByText('2026 so far · 2 vehicles');
		const axis = chart(/All-in spend by month/)?.xAxisProps as {
			ticks: string[];
			format: (v: unknown) => string;
		};
		expect(axis.ticks).toEqual(['Jan', 'Feb', 'Mar']);
		expect(axis.format('Feb')).toBe('Feb');
		const eff = chart(/by month$/)?.data as Array<{ efficiency: number }>;
		expect(eff.map(d => d.efficiency)).toEqual([30, 32]);
	});

	test('a year with no spending says so', async () => {
		api.query.mockImplementation((p: AnalyticsQueryParams) =>
			Promise.resolve({ buckets: [], series: [], totals: { value: 0 }, metric: p.metric })
		);
		render(YearEndTab);
		expect(
			await screen.findByRole('heading', { level: 2, name: 'No expenses in 2026' })
		).toBeTruthy();
	});

	test('a failed request shows the error card, and Retry loads the year again', async () => {
		api.query.mockImplementationOnce(() => Promise.reject(new Error('offline')));
		render(YearEndTab);
		expect(await screen.findByText("Couldn't load year-end summary")).toBeTruthy();
		await fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
		expect(await screen.findByText('2026 so far · 2 vehicles')).toBeTruthy();
		await waitFor(() => expect(api.getYearEnd).toHaveBeenCalledTimes(2));
	});
});
