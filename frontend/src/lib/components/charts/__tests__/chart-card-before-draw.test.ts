import type { ComponentProps } from 'svelte';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';

const drawn = vi.hoisted(() => ({ line: 0, pie: 0 }));
vi.mock('layerchart', () => ({
	LineChart: () => {
		drawn.line++;
	},
	PieChart: () => {
		drawn.pie++;
	},
	Points: () => {},
	Rule: () => {},
	Tooltip: { Root: () => {} },
	getChartContext: () => ({})
}));

const { default: AppLineChart } = await import('../AppLineChart.svelte');
const { default: AppPieChart } = await import('../AppPieChart.svelte');

let onScreen = 0.1;

class ScreenShareIntersectionObserver {
	constructor(private readonly callback: ConstructorParameters<typeof IntersectionObserver>[0]) {}
	observe(target: Element) {
		queueMicrotask(() =>
			this.callback(
				[
					{ isIntersecting: true, intersectionRatio: onScreen, target } as IntersectionObserverEntry
				],
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

async function settle() {
	for (let i = 0; i < 10; i++) await new Promise(r => setTimeout(r, 0));
}

async function mountLine() {
	vi.stubGlobal('IntersectionObserver', ScreenShareIntersectionObserver);
	const view = render(AppLineChart, {
		props: {
			title: 'Spending',
			data: [
				{ date: new Date(2026, 0, 1), amount: 120 },
				{ date: new Date(2026, 1, 1), amount: 90 }
			],
			x: 'date',
			y: 'amount',
			series: [{ key: 'amount', label: 'Amount', color: 'var(--chart-1)' }],
			config: { amount: { label: 'Amount', color: 'var(--chart-1)' } }
		} as unknown as ComponentProps<typeof AppLineChart>
	});
	await settle();
	return view;
}

async function mountPie() {
	vi.stubGlobal('IntersectionObserver', ScreenShareIntersectionObserver);
	render(AppPieChart, {
		props: {
			title: 'Spending by category',
			data: [
				{ key: 'fuel', label: 'Fuel', value: 60, color: '#f00', percentage: 60 },
				{ key: 'maintenance', label: 'Maintenance', value: 40, color: '#0f0', percentage: 40 }
			]
		}
	});
	await settle();
}

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	drawn.line = 0;
	drawn.pie = 0;
	onScreen = 0.1;
});

describe('a chart whose plot only peeks onto the screen', () => {
	test('waits to draw, holding its height with the skeleton and its text alternative', async () => {
		const { container } = await mountLine();

		expect(drawn.line).toBe(0);
		const placeholder = screen.getByRole('img');
		expect(placeholder).toHaveAttribute('data-slot', 'skeleton');
		expect(placeholder.getAttribute('aria-label')).toContain('Spending');
		expect(container.querySelector('[data-slot="skeleton"]')).toHaveStyle({ height: '300px' });
	});

	test('the Table view is there before the chart draws', async () => {
		await mountLine();

		await fireEvent.click(screen.getByRole('button', { name: 'Table' }));

		expect(screen.getByRole('table')).toBeInTheDocument();
		expect(drawn.line).toBe(0);
	});

	test('a pie chart waits the same way and carries its own text alternative', async () => {
		await mountPie();

		expect(drawn.pie).toBe(0);
		const placeholder = screen.getByRole('img');
		expect(placeholder).toHaveAttribute('data-slot', 'skeleton');
		expect(placeholder.getAttribute('aria-label')).toContain('Spending by category');
	});
});

describe('a chart a quarter on screen', () => {
	test('draws, leaving one plot with the text alternative', async () => {
		onScreen = 0.25;
		await mountLine();

		expect(drawn.line).toBe(1);
		const plots = screen.getAllByRole('img');
		expect(plots).toHaveLength(1);
		expect(plots[0]).toHaveAttribute('tabindex', '0');
		expect(document.querySelector('[data-slot="skeleton"]')).toBeNull();
	});

	test('a pie chart draws as soon as its card does', async () => {
		onScreen = 0.25;
		await mountPie();

		expect(drawn.pie).toBe(1);
		expect(screen.getAllByRole('img')).toHaveLength(1);
	});
});
