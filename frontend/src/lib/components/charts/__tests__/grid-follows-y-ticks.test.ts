import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render } from '@testing-library/svelte';

type ChartProps = {
	props?: { yAxis?: { ticks?: unknown }; grid?: { yTicks?: unknown } };
};

const { drawn } = vi.hoisted(() => ({ drawn: vi.fn() }));

vi.mock('layerchart', () => ({
	LineChart: (_anchor: unknown, props: ChartProps) => drawn(props),
	BarChart: (_anchor: unknown, props: ChartProps) => drawn(props),
	AreaChart: (_anchor: unknown, props: ChartProps) => drawn(props),
	Points: () => {},
	Tooltip: { Root: () => {} },
	getChartContext: () => ({})
}));

const AppLineChart = (await import('../AppLineChart.svelte')).default;
const AppBarChart = (await import('../AppBarChart.svelte')).default;
const AppAreaChart = (await import('../AppAreaChart.svelte')).default;

class VisibleIntersectionObserver {
	constructor(private readonly callback: ConstructorParameters<typeof IntersectionObserver>[0]) {}
	observe(target: Element) {
		queueMicrotask(() =>
			this.callback(
				[{ isIntersecting: true, target } as IntersectionObserverEntry],
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

const SERIES = [{ key: 'a', label: 'Sedan', color: 'var(--chart-1)' }];
const DATA = [
	{ month: new Date('2026-01-01'), a: 1 },
	{ month: new Date('2026-02-01'), a: 3 }
];
const CONFIG = { a: { label: 'Sedan', color: 'var(--chart-1)' } };

async function settle() {
	for (let i = 0; i < 10; i++) await new Promise(r => setTimeout(r, 0));
}

let offsetParent: PropertyDescriptor | undefined;

beforeEach(() => {
	vi.clearAllMocks();
	vi.stubGlobal('IntersectionObserver', VisibleIntersectionObserver);
	offsetParent = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetParent');
	Object.defineProperty(HTMLElement.prototype, 'offsetParent', {
		configurable: true,
		get: () => document.body
	});
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	if (offsetParent) Object.defineProperty(HTMLElement.prototype, 'offsetParent', offsetParent);
});

describe('grid lines follow the y-axis labels', () => {
	test.each([
		['AppLineChart', AppLineChart],
		['AppBarChart', AppBarChart],
		['AppAreaChart', AppAreaChart]
	] as const)('%s gives the grid the same y ticks as the axis', async (_name, Component) => {
		render(Component as typeof AppLineChart, {
			props: { title: 'Cost', data: DATA, x: 'month', y: 'a', series: SERIES, config: CONFIG }
		});
		await settle();

		const { props } = drawn.mock.calls.at(-1)?.[0] as ChartProps;
		expect(typeof props?.yAxis?.ticks).toBe('function');
		expect(props?.grid?.yTicks).toBe(props?.yAxis?.ticks);
	});

	test('a horizontal bar chart leaves its value grid to layerchart', async () => {
		render(AppBarChart, {
			props: {
				title: 'Cost',
				data: DATA,
				x: 'month',
				y: 'a',
				series: SERIES,
				config: CONFIG,
				orientation: 'horizontal'
			}
		});
		await settle();

		const { props } = drawn.mock.calls.at(-1)?.[0] as ChartProps;
		expect(props?.grid).toBeUndefined();
	});
});
