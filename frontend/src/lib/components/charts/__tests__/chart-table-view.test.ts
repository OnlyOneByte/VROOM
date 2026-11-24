import type { ComponentProps } from 'svelte';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/svelte';
import {
	formatCurrencyTooltip,
	formatMonthLabel,
	unitTooltip
} from '#lib/utils/chart-formatters.ts';

vi.mock('layerchart', () => ({
	LineChart: () => {},
	BarChart: () => {},
	AreaChart: () => {},
	Points: () => {},
	Tooltip: { Root: () => {} },
	getChartContext: () => ({})
}));

const { default: AppLineChart } = await import('../AppLineChart.svelte');
const { default: AppBarChart } = await import('../AppBarChart.svelte');
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

const DATA = [
	{ date: new Date(2026, 0, 1), fuel: 120.5, maintenance: 80 },
	{ date: new Date(2026, 1, 1), fuel: 98.25, maintenance: null },
	{ date: new Date(2026, 2, 1), fuel: 130, maintenance: 410.1 }
];
const SERIES = [
	{ key: 'fuel', label: 'Fuel', color: 'var(--chart-1)' },
	{ key: 'maintenance', label: 'Maintenance', color: 'var(--chart-2)' }
];
const CONFIG = {
	fuel: { label: 'Fuel', color: 'var(--chart-1)' },
	maintenance: { label: 'Maintenance', color: 'var(--chart-2)' }
};
const MPG = unitTooltip('mi/gal');

const CASES = [
	{
		name: 'AppBarChart',
		component: AppBarChart,
		props: { x: 'date', series: SERIES, seriesLayout: 'stack' },
		format: formatCurrencyTooltip
	},
	{
		name: 'AppLineChart',
		component: AppLineChart,
		props: { x: 'date', y: ['fuel', 'maintenance'], series: SERIES, tooltipFormat: MPG },
		format: MPG
	},
	{
		name: 'AppAreaChart',
		component: AppAreaChart,
		props: { x: 'date', y: ['fuel', 'maintenance'], series: SERIES },
		format: formatCurrencyTooltip
	}
] as const;

async function settle() {
	for (let i = 0; i < 10; i++) await new Promise(r => setTimeout(r, 0));
}

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

describe.each(CASES)('$name table view', ({ component, props, format }) => {
	async function mount() {
		vi.stubGlobal('IntersectionObserver', VisibleIntersectionObserver);
		render(component as typeof AppLineChart, {
			props: {
				title: 'Spending',
				description: 'Per month',
				data: DATA,
				config: CONFIG,
				...props
			} as unknown as ComponentProps<typeof AppLineChart>
		});
		await settle();
	}

	test('the toggle is a labelled button group with aria-pressed', async () => {
		await mount();
		const group = screen.getByRole('group', { name: 'Show Spending as' });
		const chart = within(group).getByRole('button', { name: 'Chart' });
		const table = within(group).getByRole('button', { name: 'Table' });
		expect(chart).toHaveAttribute('aria-pressed', 'true');
		expect(table).toHaveAttribute('aria-pressed', 'false');
		await fireEvent.click(table);
		expect(table).toHaveAttribute('aria-pressed', 'true');
		expect(chart).toHaveAttribute('aria-pressed', 'false');
	});

	test('every bucket shows the tooltip formatter output for every series', async () => {
		await mount();
		await fireEvent.click(screen.getByRole('button', { name: 'Table' }));
		const table = screen.getByRole('table');
		expect(within(table).getByText('Spending. Per month')).toBeInTheDocument();
		const headers = within(table)
			.getAllByRole('columnheader')
			.map(h => h.textContent?.trim());
		expect(headers).toEqual(['Month', 'Fuel', 'Maintenance']);
		const rows = within(table).getAllByRole('row').slice(1);
		expect(rows).toHaveLength(DATA.length);
		rows.forEach((row, i) => {
			const d = DATA[i]!;
			expect(within(row).getByRole('rowheader')).toHaveTextContent(formatMonthLabel(d.date));
			const cells = within(row)
				.getAllByRole('cell')
				.map(c => c.textContent?.trim());
			expect(cells).toEqual([
				format(d.fuel, 'fuel'),
				d.maintenance === null ? '—' : format(d.maintenance, 'maintenance')
			]);
		});
	});

	test('the plot is one tab stop with a generated summary', async () => {
		await mount();
		const plot = screen.getByRole('img');
		expect(plot).toHaveAttribute('tabindex', '0');
		expect(plot.getAttribute('aria-label')).toBe(
			`Spending: 3 points, Jan 2026 to Mar 2026. Highest: Maintenance, Mar 2026, ${format(410.1, 'maintenance')}. Lowest: Maintenance, Jan 2026, ${format(80, 'maintenance')}.`
		);
	});
});

describe('the toggle stays out of the way when there is nothing to show', () => {
	test.each([
		['loading', { isLoading: true }],
		['error', { error: 'Boom' }],
		['empty', { data: [] }]
	])('%s', async (_label, extra) => {
		vi.stubGlobal('IntersectionObserver', VisibleIntersectionObserver);
		render(AppBarChart, {
			props: { title: 'Spending', data: DATA, x: 'date', series: SERIES, config: CONFIG, ...extra }
		});
		await settle();
		expect(screen.queryByRole('group', { name: 'Show Spending as' })).toBeNull();
	});
});
