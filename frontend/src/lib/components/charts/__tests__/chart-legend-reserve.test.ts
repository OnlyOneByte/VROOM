import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/svelte';

const { drawn } = vi.hoisted(() => ({ drawn: vi.fn() }));

vi.mock('layerchart', () => ({
	LineChart: () => drawn('line'),
	BarChart: () => drawn('bar'),
	AreaChart: () => drawn('area'),
	Points: () => {},
	Tooltip: { Root: () => {} },
	getChartContext: () => ({})
}));

const AppLineChart = (await import('../AppLineChart.svelte')).default;
const AppBarChart = (await import('../AppBarChart.svelte')).default;
const AppAreaChart = (await import('../AppAreaChart.svelte')).default;

class NeverIntersectingObserver {
	observe() {}
	unobserve() {}
	disconnect() {}
	takeRecords() {
		return [];
	}
}

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
	{ key: 'a', label: 'Sedan', color: 'var(--chart-1)' },
	{ key: 'b', label: 'Truck', color: 'var(--chart-2)' }
];
const DATA = [
	{ month: new Date('2026-01-01'), a: 1, b: 2 },
	{ month: new Date('2026-02-01'), a: 3, b: 4 }
];
const CONFIG = {
	a: { label: 'Sedan', color: 'var(--chart-1)' },
	b: { label: 'Truck', color: 'var(--chart-2)' }
};

const WRAPPERS = [
	['AppLineChart', AppLineChart],
	['AppBarChart', AppBarChart],
	['AppAreaChart', AppAreaChart]
] as const;

async function settle() {
	for (let i = 0; i < 10; i++) await new Promise(r => setTimeout(r, 0));
}

async function mount(Component: (typeof WRAPPERS)[number][1], height = 280) {
	const view = render(Component as typeof AppLineChart, {
		props: {
			title: 'Cost',
			data: DATA,
			x: 'month',
			y: ['a', 'b'],
			series: SERIES,
			config: CONFIG,
			height
		}
	});
	await settle();
	return view;
}

let offsetParent: PropertyDescriptor | undefined;

beforeEach(() => {
	vi.clearAllMocks();
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

describe('chart placeholders reserve the legend', () => {
	test.each(WRAPPERS)(
		'%s shows its legend under the placeholder before the chart draws',
		async (_name, Component) => {
			vi.stubGlobal('IntersectionObserver', NeverIntersectingObserver);
			const { container } = await mount(Component);
			expect(drawn).not.toHaveBeenCalled();
			const items = within(screen.getByRole('list')).getAllByRole('listitem');
			expect(items.map(i => i.textContent?.trim())).toEqual(['Sedan', 'Truck']);
			expect(container.querySelector('[style*="min-height: 280px"]')).not.toBeNull();
		}
	);

	test.each(WRAPPERS)(
		'%s keeps one legend in the same place once the chart draws',
		async (_name, Component) => {
			vi.stubGlobal('IntersectionObserver', VisibleIntersectionObserver);
			const { container } = await mount(Component);
			expect(drawn).toHaveBeenCalled();
			expect(screen.getAllByRole('list')).toHaveLength(1);
			const gate = container.querySelector('[style*="min-height: 280px"]');
			expect(gate?.querySelector('[role="list"]')).toBeNull();
			expect(gate?.nextElementSibling?.getAttribute('role')).toBe('list');
		}
	);
});
