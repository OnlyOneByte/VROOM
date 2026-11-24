import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';

vi.mock('layerchart', () => ({
	LineChart: () => {},
	BarChart: () => {},
	Points: () => {},
	Rule: () => {},
	Tooltip: { Root: () => {} },
	getChartContext: () => ({})
}));

const { default: AppLineChart } = await import('../AppLineChart.svelte');
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

const SERIES = [
	{ key: 'fuel', label: 'Fuel', color: 'var(--chart-1)' },
	{ key: 'maintenance', label: 'Maintenance', color: 'var(--chart-2)' }
];
const CONFIG = {
	fuel: { label: 'Fuel', color: 'var(--chart-1)' },
	maintenance: { label: 'Maintenance', color: 'var(--chart-2)' }
};

async function settle() {
	for (let i = 0; i < 10; i++) await new Promise(r => setTimeout(r, 0));
}

function markup(container: HTMLElement): string {
	return container.innerHTML.replace(/<!--[^]*?-->/g, '');
}

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

describe('charts without annotations render as before', () => {
	test('a line chart', async () => {
		vi.stubGlobal('IntersectionObserver', VisibleIntersectionObserver);
		const { container } = render(AppLineChart, {
			title: 'Cost per month',
			data: [
				{ date: new Date(Date.UTC(2026, 0, 1)), fuel: 40, maintenance: 10 },
				{ date: new Date(Date.UTC(2026, 1, 1)), fuel: 42, maintenance: null }
			],
			x: 'date',
			y: ['fuel', 'maintenance'],
			series: SERIES,
			config: CONFIG,
			referenceLines: [{ value: 30, label: 'Fleet average' }]
		});
		await settle();
		expect(markup(container)).toMatchSnapshot();
	});

	test('a bar chart', async () => {
		vi.stubGlobal('IntersectionObserver', VisibleIntersectionObserver);
		const { container } = render(AppBarChart, {
			title: 'Cost per month',
			data: [
				{ label: 'Jan', fuel: 40, maintenance: 10 },
				{ label: 'Feb', fuel: 42, maintenance: 0 }
			],
			x: 'label',
			y: ['fuel', 'maintenance'],
			series: SERIES,
			config: CONFIG,
			seriesLayout: 'stack'
		});
		await settle();
		expect(markup(container)).toMatchSnapshot();
	});

	test('a line chart in Table view', async () => {
		vi.stubGlobal('IntersectionObserver', VisibleIntersectionObserver);
		const { container } = render(AppLineChart, {
			title: 'Cost per month',
			data: [{ date: new Date(Date.UTC(2026, 0, 1)), fuel: 40, maintenance: 10 }],
			x: 'date',
			y: ['fuel', 'maintenance'],
			series: SERIES,
			config: CONFIG
		});
		await settle();
		await fireEvent.click(screen.getByRole('button', { name: 'Table' }));
		await settle();
		expect(markup(container)).toMatchSnapshot();
	});
});
