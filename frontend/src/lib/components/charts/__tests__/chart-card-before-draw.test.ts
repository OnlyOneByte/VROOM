import type { ComponentProps } from 'svelte';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';

const drawn = vi.hoisted(() => ({ count: 0 }));
vi.mock('layerchart', () => ({
	LineChart: () => {
		drawn.count++;
	},
	Points: () => {},
	Rule: () => {},
	Tooltip: { Root: () => {} },
	getChartContext: () => ({})
}));

const { default: AppLineChart } = await import('../AppLineChart.svelte');

class PeekingIntersectionObserver {
	constructor(private readonly callback: ConstructorParameters<typeof IntersectionObserver>[0]) {}
	observe(target: Element) {
		queueMicrotask(() =>
			this.callback(
				[{ isIntersecting: true, intersectionRatio: 0.1, target } as IntersectionObserverEntry],
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

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	drawn.count = 0;
});

describe('a chart whose plot only peeks onto the screen', () => {
	async function mount() {
		vi.stubGlobal('IntersectionObserver', PeekingIntersectionObserver);
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

	test('waits to draw, holding its height with the skeleton and its text alternative', async () => {
		const { container } = await mount();

		expect(drawn.count).toBe(0);
		const placeholder = screen.getByRole('img');
		expect(placeholder).toHaveAttribute('data-slot', 'skeleton');
		expect(placeholder.getAttribute('aria-label')).toContain('Spending');
		expect(container.querySelector('[data-slot="skeleton"]')).toHaveStyle({ height: '300px' });
	});

	test('the Table view is there before the chart draws', async () => {
		await mount();

		await fireEvent.click(screen.getByRole('button', { name: 'Table' }));

		expect(screen.getByRole('table')).toBeInTheDocument();
		expect(drawn.count).toBe(0);
	});
});
