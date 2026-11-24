import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/svelte';

type Props = Record<string, unknown>;

const seen = vi.hoisted(() => ({
	chart: null as Props | null,
	bars: [] as Props[],
	labels: [] as Props[],
	rules: [] as Props[],
	texts: [] as Props[]
}));

vi.mock('layerchart', () => ({
	BarChart: (
		anchor: unknown,
		props: Props & { aboveMarks?: (a: unknown, c: () => unknown) => void }
	) => {
		seen.chart = props;
		props.aboveMarks?.(anchor, () => ({ context: { width: 400, yScale: (v: number) => 200 - v } }));
	},
	Bar: (_anchor: unknown, props: Props) => {
		seen.bars.push({ ...props });
	},
	Labels: (_anchor: unknown, props: Props) => {
		seen.labels.push({ ...props });
	},
	Rule: (_anchor: unknown, props: Props) => {
		seen.rules.push({ ...props });
	},
	Text: (_anchor: unknown, props: Props) => {
		seen.texts.push({ ...props });
	},
	Tooltip: { Root: () => {} },
	getChartContext: () => ({})
}));

const { default: AppBarChart } = await import('../AppBarChart.svelte');

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

const MONTHS = [
	{ date: new Date(2026, 5, 1), amount: 751 },
	{ date: new Date(2026, 6, 1), amount: 532 },
	{ date: new Date(2026, 7, 1), amount: 113 }
];

const SINGLE = {
	title: 'Running cost',
	data: MONTHS,
	x: 'date',
	y: 'amount',
	series: [{ key: 'amount', label: 'Running cost', color: 'var(--chart-1)' }],
	config: { amount: { label: 'Running cost', color: 'var(--chart-1)' } }
};

async function settle() {
	for (let i = 0; i < 10; i++) await new Promise(r => setTimeout(r, 0));
}

async function mount(props: Props) {
	vi.stubGlobal('IntersectionObserver', VisibleIntersectionObserver);
	const view = render(AppBarChart, { props: props as never });
	await settle();
	return view;
}

function barsConfig(): Props {
	return (seen.chart?.['props'] as Props)['bars'] as Props;
}

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	seen.chart = null;
	seen.bars = [];
	seen.labels = [];
	seen.rules = [];
	seen.texts = [];
});

describe('C3 bar columns', () => {
	test('columns are rounded at their end', async () => {
		await mount(SINGLE);
		expect(barsConfig()).toMatchObject({ rounded: 'edge', radius: 6, stroke: 'none' });
	});

	test('the current period is drawn again in ink on top of its column', async () => {
		await mount({ ...SINGLE, current: new Date(2026, 7, 1) });
		expect(seen.bars).toHaveLength(1);
		expect(seen.bars[0]).toMatchObject({ data: MONTHS[2], y: 'amount', fill: 'var(--foreground)' });
	});

	test('with no current period nothing is drawn in ink', async () => {
		await mount(SINGLE);
		expect(seen.bars).toHaveLength(0);
	});

	test('value labels sit on the peak and the current period only', async () => {
		await mount({ ...SINGLE, current: new Date(2026, 7, 1) });
		expect(seen.labels).toHaveLength(1);
		expect(seen.labels[0]?.['data']).toEqual([MONTHS[0], MONTHS[2]]);
	});

	test('when the current period is the peak there is one label', async () => {
		await mount({ ...SINGLE, current: new Date(2026, 5, 1) });
		expect(seen.labels[0]?.['data']).toEqual([MONTHS[0]]);
	});

	test('value labels can be turned off, and never show on several series', async () => {
		await mount({ ...SINGLE, valueLabels: false });
		expect(seen.labels).toHaveLength(0);
		cleanup();
		await mount({
			...SINGLE,
			y: undefined,
			series: [
				{ key: 'fuel', label: 'Fuel', color: 'var(--chart-1)' },
				{ key: 'upkeep', label: 'Upkeep', color: 'var(--chart-2)' }
			]
		});
		expect(seen.labels).toHaveLength(0);
	});

	test('a reference line is dashed and labelled on the plot, and read in the summary', async () => {
		await mount({ ...SINGLE, referenceLines: [{ value: 311, label: 'Avg' }] });
		expect(seen.rules[0]).toMatchObject({ y: 311, dashArray: '4 4' });
		expect(seen.texts[0]).toMatchObject({ value: 'Avg $311', x: 400, y: 200 - 311 - 6 });
		expect(screen.getByRole('img').getAttribute('aria-label')).toContain('Avg: $311.00.');
	});

	test('a stack rounds only the top segment that has a value', async () => {
		await mount({
			...SINGLE,
			y: undefined,
			seriesLayout: 'stack',
			data: [{ date: new Date(2026, 5, 1), fuel: 700, upkeep: 0 }],
			series: [
				{ key: 'fuel', label: 'Fuel', color: 'var(--chart-1)' },
				{ key: 'upkeep', label: 'Upkeep', color: 'var(--chart-2)' }
			]
		});
		expect(barsConfig()['rounded']).toBe('none');
		const series = seen.chart?.['series'] as Array<{ props: { rounded: (row: Props) => string } }>;
		const row = { fuel: 700, upkeep: 0 };
		expect(series[0]?.props.rounded(row)).toBe('top');
		expect(series[1]?.props.rounded(row)).toBe('top');
		expect(series[0]?.props.rounded({ fuel: 700, upkeep: 40 })).toBe('none');
	});

	test('the insight sentence shows only under a chart with data', async () => {
		const insight = 'June was the tires: $751.';
		await mount({ ...SINGLE, insight });
		expect(screen.getByText(insight)).toHaveAttribute('data-chart-insight');
		for (const state of [{ isLoading: true }, { error: 'Offline' }, { data: [] }]) {
			cleanup();
			await mount({ ...SINGLE, insight, ...state });
			expect(screen.queryByText(insight)).toBeNull();
		}
	});

	test('on horizontal bars the current overlay and its value follow the x key', async () => {
		const cars = [
			{ car: 'Weekend Car', mpg: 35 },
			{ car: 'Daily Driver', mpg: 31 }
		];
		await mount({
			...SINGLE,
			data: cars,
			x: 'mpg',
			y: 'car',
			orientation: 'horizontal',
			series: [{ key: 'mpg', label: 'mpg', color: 'var(--chart-3)' }],
			current: 'Daily Driver'
		});
		expect(seen.bars).toHaveLength(1);
		expect(seen.bars[0]).toMatchObject({ data: cars[1], x: 'mpg', fill: 'var(--foreground)' });
		expect(barsConfig()).toMatchObject({ height: 10, radius: 5 });
	});

	test('a horizontal reference line is listed under the chart, since it has no label on the plot', async () => {
		await mount({
			...SINGLE,
			data: [{ car: 'Weekend Car', mpg: 35 }],
			x: 'mpg',
			y: 'car',
			orientation: 'horizontal',
			yAxisFormat: (v: number) => `${v} mpg`,
			series: [{ key: 'mpg', label: 'mpg', color: 'var(--chart-3)' }],
			referenceLines: [{ value: 33, label: 'Fleet' }]
		});
		expect(seen.texts).toHaveLength(0);
		expect(screen.getByRole('list', { name: 'Reference lines' })).toHaveTextContent(
			'Fleet: 33 mpg'
		);
	});
});
