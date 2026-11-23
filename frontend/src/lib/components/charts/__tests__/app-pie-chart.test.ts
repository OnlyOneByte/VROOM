import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/svelte';

interface PieItem {
	key: string;
	label: string;
	value: number;
	color: string;
	percentage?: number;
}

interface PieChartProps {
	data: PieItem[];
	cRange: string[];
}

const { pieChart } = vi.hoisted(() => ({
	pieChart: vi.fn<(props: PieChartProps) => void>()
}));

vi.mock('layerchart', () => ({
	PieChart: (_anchor: unknown, props: PieChartProps) => {
		pieChart({ data: props.data, cRange: props.cRange });
	},
	Tooltip: { Root: () => {} },
	getChartContext: () => ({})
}));

const AppPieChart = (await import('../AppPieChart.svelte')).default;

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

const DATA: PieItem[] = [
	{ key: 'fuel', label: 'Fuel', value: 1234.5, color: '#f00', percentage: 61.72 },
	{ key: 'maintenance', label: 'Maintenance', value: 765.5, color: '#0f0', percentage: 38.28 }
];

async function settle() {
	for (let i = 0; i < 10; i++) await new Promise(r => setTimeout(r, 0));
}

async function mount(props: Partial<Parameters<typeof render>[1] & object> = {}) {
	const view = render(AppPieChart, {
		props: { title: 'Spending by category', data: DATA, ...props }
	});
	await settle();
	return view;
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

describe('AppPieChart', () => {
	test('renders the title and description', async () => {
		await mount({ description: 'Last 12 months' });
		expect(screen.getByText('Spending by category')).toBeInTheDocument();
		expect(screen.getByText('Last 12 months')).toBeInTheDocument();
	});

	test('the legend lists each slice with a currency value and one-decimal percentage', async () => {
		await mount();
		const items = within(screen.getByRole('list', { name: 'Categories' })).getAllByRole('listitem');
		expect(items).toHaveLength(2);
		expect(items[0]).toHaveTextContent('Fuel');
		expect(items[0]).toHaveTextContent('$1,234.50');
		expect(items[0]).toHaveTextContent('61.7%');
		expect(items[1]).toHaveTextContent('Maintenance');
		expect(items[1]).toHaveTextContent('$765.50');
		expect(items[1]).toHaveTextContent('38.3%');
	});

	test('a slice without a percentage shows only its value', async () => {
		await mount({ data: [{ key: 'misc', label: 'Misc', value: 10, color: '#00f' }] });
		const item = within(screen.getByRole('list', { name: 'Categories' })).getByRole('listitem');
		expect(item).toHaveTextContent('$10.00');
		expect(item.textContent).not.toContain('%');
	});

	test('a zero percentage is still shown', async () => {
		await mount({
			data: [{ key: 'misc', label: 'Misc', value: 0, color: '#00f', percentage: 0 }]
		});
		expect(screen.getByText('0.0%')).toBeInTheDocument();
	});

	test('passes the data and slice colours to the pie once visible', async () => {
		await mount();
		expect(pieChart).toHaveBeenCalledWith({ data: DATA, cRange: ['#f00', '#0f0'] });
	});

	test('the legend can be hidden', async () => {
		await mount({ showLegend: false });
		expect(screen.queryByRole('list', { name: 'Categories' })).toBeNull();
		expect(pieChart).toHaveBeenCalled();
	});

	test('with no data it shows the empty state and no pie', async () => {
		await mount({ data: [] });
		expect(screen.getByText('No data available')).toBeInTheDocument();
		expect(screen.queryByRole('list', { name: 'Categories' })).toBeNull();
		expect(pieChart).not.toHaveBeenCalled();
	});

	test('an error replaces the chart with the error message', async () => {
		await mount({ error: 'Analytics unavailable' });
		expect(screen.getByText("Couldn't load the chart")).toBeInTheDocument();
		expect(screen.getByText('Analytics unavailable')).toBeInTheDocument();
		expect(screen.queryByRole('list', { name: 'Categories' })).toBeNull();
	});

	test('while loading it shows neither legend nor pie', async () => {
		await mount({ isLoading: true });
		expect(screen.queryByRole('list', { name: 'Categories' })).toBeNull();
		expect(pieChart).not.toHaveBeenCalled();
	});

	test('the pie is one tab stop with a summary, and the value list stays readable', async () => {
		await mount();
		const plot = screen.getByRole('img');
		expect(plot).toHaveAttribute('tabindex', '0');
		expect(plot).toHaveAttribute(
			'aria-label',
			'Spending by category: 2 categories. Highest: Fuel, $1,234.50, 61.7%. Lowest: Maintenance, $765.50, 38.3%.'
		);
		expect(plot.contains(screen.getByRole('list', { name: 'Categories' }))).toBe(false);
	});

	test('arrow keys step through the slices and mark the matching legend row', async () => {
		await mount();
		const plot = screen.getByRole('img');
		const live = plot.parentElement!.querySelector('[aria-live="polite"]')!;
		await fireEvent.keyDown(plot, { key: 'ArrowRight' });
		expect(live.textContent).toBe('Fuel: $1,234.50, 61.7%. 1 of 2.');
		const items = within(screen.getByRole('list', { name: 'Categories' })).getAllByRole('listitem');
		expect(items[0]).toHaveClass('bg-muted');
		await fireEvent.keyDown(plot, { key: 'ArrowRight' });
		expect(live.textContent).toBe('Maintenance: $765.50, 38.3%. 2 of 2.');
		expect(items[0]).not.toHaveClass('bg-muted');
		expect(items[1]).toHaveClass('bg-muted');
		await fireEvent.keyDown(plot, { key: 'Escape' });
		expect(items[1]).not.toHaveClass('bg-muted');
	});

	test('nothing chart-related renders until the card scrolls into view', async () => {
		vi.stubGlobal(
			'IntersectionObserver',
			class {
				observe() {}
				unobserve() {}
				disconnect() {}
				takeRecords() {
					return [];
				}
			}
		);
		await mount();
		expect(screen.queryByRole('list', { name: 'Categories' })).toBeNull();
		expect(pieChart).not.toHaveBeenCalled();
	});
});
