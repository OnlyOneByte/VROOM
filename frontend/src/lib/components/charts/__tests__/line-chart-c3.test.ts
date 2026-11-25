import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/svelte';
import { curveLinear } from 'd3-shape';
import { scaleLinear } from 'd3-scale';

type Props = Record<string, unknown>;

const seen = vi.hoisted(() => ({ props: null as Props | null }));

vi.mock('layerchart', () => ({
	LineChart: (_anchor: unknown, props: Props) => {
		seen.props = props;
	},
	AreaChart: (_anchor: unknown, props: Props) => {
		seen.props = props;
	},
	Points: () => {},
	Rule: () => {},
	Tooltip: { Root: () => {} },
	getChartContext: () => ({})
}));

const { default: AppLineChart } = await import('../AppLineChart.svelte');
const { default: AppAreaChart } = await import('../AppAreaChart.svelte');

class VisibleIntersectionObserver {
	constructor(private readonly callback: ConstructorParameters<typeof IntersectionObserver>[0]) {}
	observe(target: Element) {
		queueMicrotask(() =>
			this.callback(
				[{ isIntersecting: true, intersectionRatio: 1, target } as IntersectionObserverEntry],
				this as unknown as IntersectionObserver
			)
		);
	}
	unobserve() {}
	disconnect() {}
	takeRecords() {
		return [];
	}
}

const PRICES = {
	title: 'Price per gallon',
	data: [
		{ date: new Date(2026, 0, 1), price: 3.57 },
		{ date: new Date(2026, 1, 1), price: 3.69 },
		{ date: new Date(2026, 2, 1), price: 3.6 }
	],
	x: 'date',
	y: 'price',
	series: [{ key: 'price', label: 'Price', color: 'var(--chart-1)' }],
	config: { price: { label: 'Price', color: 'var(--chart-1)' } },
	yAxisFormat: (v: number) => v.toFixed(1)
};

async function mount(component: typeof AppLineChart | typeof AppAreaChart, props: Props) {
	vi.stubGlobal('IntersectionObserver', VisibleIntersectionObserver);
	render(component as typeof AppLineChart, { props: props as never });
	for (let i = 0; i < 10; i++) await new Promise(r => setTimeout(r, 0));
}

function chartProps(): Props {
	return seen.props?.['props'] as Props;
}

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	seen.props = null;
});

describe('C3 lines', () => {
	test('a trend is a straight 2.4 px line', async () => {
		await mount(AppLineChart, PRICES);
		expect(chartProps()['spline']).toEqual({ curve: curveLinear, strokeWidth: 2.4 });
	});

	test('a single reading keeps its marker', async () => {
		await mount(AppLineChart, { ...PRICES, data: PRICES.data.slice(0, 1) });
		expect(chartProps()['points']).toBeDefined();
		expect(chartProps()['spline']).not.toHaveProperty('strokeWidth');
	});

	test('the value axis carries three guide values', async () => {
		await mount(AppLineChart, PRICES);
		const ticks = (chartProps()['yAxis'] as { ticks: (s: unknown) => number[] }).ticks;
		expect(ticks(scaleLinear().domain([3.5, 3.7]))).toHaveLength(3);
	});

	test('area charts carry three guide values too', async () => {
		await mount(AppAreaChart, PRICES);
		const ticks = (chartProps()['yAxis'] as { ticks: (s: unknown) => number[] }).ticks;
		expect(ticks(scaleLinear().domain([0, 6000]))).toHaveLength(3);
	});

	test('lines and areas show the insight sentence under the chart', async () => {
		const insight = 'November was the cheapest month.';
		await mount(AppLineChart, { ...PRICES, insight });
		expect(screen.getByText(insight)).toHaveAttribute('data-chart-insight');
		cleanup();
		await mount(AppAreaChart, { ...PRICES, insight });
		expect(screen.getByText(insight)).toHaveAttribute('data-chart-insight');
	});
});
