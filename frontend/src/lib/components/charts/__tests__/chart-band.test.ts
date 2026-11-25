import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';

vi.mock('layerchart', () => ({
	Area: () => {},
	LineChart: () => {},
	Points: () => {},
	Rule: () => {},
	Tooltip: { Root: () => {} },
	getChartContext: () => ({})
}));

const { default: AppLineChart } = await import('../AppLineChart.svelte');

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
	{ key: 'current', label: 'This period', color: 'var(--chart-1)' },
	{ key: 'previous', label: 'The year before', color: 'var(--chart-4)' }
];

async function settle() {
	for (let i = 0; i < 10; i++) await new Promise(r => setTimeout(r, 0));
}

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

describe('a line chart with a shaded band', () => {
	test('names the band in its text alternative and shows empty months as No data', async () => {
		vi.stubGlobal('IntersectionObserver', VisibleIntersectionObserver);
		render(AppLineChart, {
			title: 'Cost per month',
			data: [
				{ date: new Date(Date.UTC(2026, 0, 1)), current: 40, previous: 30 },
				{ date: new Date(Date.UTC(2026, 1, 1)), current: null, previous: 35 }
			],
			x: 'date',
			y: ['current', 'previous'],
			series: SERIES,
			config: {
				current: { label: 'This period', color: 'var(--chart-1)' },
				previous: { label: 'The year before', color: 'var(--chart-4)' }
			},
			band: { from: 'previous', to: 'current' }
		});
		await settle();
		expect(
			screen.getByRole('img', {
				name: /The shaded area is the gap between The year before and This period\./
			})
		).toBeInTheDocument();
		await fireEvent.click(screen.getByRole('button', { name: 'Table' }));
		await settle();
		expect(screen.getByRole('cell', { name: 'No data' })).toBeInTheDocument();
	});
});
