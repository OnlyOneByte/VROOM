import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';

const { tooltip } = vi.hoisted(() => ({
	tooltip: { show: vi.fn(), hide: vi.fn() }
}));

vi.mock('layerchart', () => ({
	LineChart: (_anchor: unknown, props: { context?: unknown }) => {
		props.context = { tooltip };
	},
	Points: () => {},
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

const DATA = [
	{ date: new Date(2026, 0, 1), amount: 10 },
	{ date: new Date(2026, 1, 1), amount: 25.5 },
	{ date: new Date(2026, 2, 1), amount: 7 }
];

async function mount(onSelect?: (row: Record<string, unknown>, key: string | null) => void) {
	vi.stubGlobal('IntersectionObserver', VisibleIntersectionObserver);
	render(AppLineChart, {
		props: {
			title: 'Spending',
			data: DATA,
			x: 'date',
			y: 'amount',
			series: [{ key: 'amount', label: 'Amount', color: 'var(--primary)' }],
			config: { amount: { label: 'Amount', color: 'var(--primary)' } },
			...(onSelect && { onSelect })
		}
	});
	for (let i = 0; i < 10; i++) await new Promise(r => setTimeout(r, 0));
	const plot = screen.getByRole('img');
	const live = plot.parentElement!.querySelector('[aria-live="polite"]')!;
	return { plot, live };
}

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	tooltip.show.mockClear();
	tooltip.hide.mockClear();
});

describe('keyboard stepping through a chart', () => {
	test('arrows move across buckets and the live region reads the tooltip text', async () => {
		const { plot, live } = await mount();
		expect(live.textContent).toBe('');

		await fireEvent.keyDown(plot, { key: 'ArrowRight' });
		expect(live.textContent).toBe('Jan 2026: $10.00. 1 of 3.');
		expect(tooltip.show).toHaveBeenLastCalledWith({ data: DATA[0] });

		await fireEvent.keyDown(plot, { key: 'ArrowRight' });
		expect(live.textContent).toBe('Feb 2026: $25.50. 2 of 3.');
		expect(tooltip.show).toHaveBeenLastCalledWith({ data: DATA[1] });

		await fireEvent.keyDown(plot, { key: 'End' });
		await fireEvent.keyDown(plot, { key: 'ArrowRight' });
		expect(live.textContent).toBe('Mar 2026: $7.00. 3 of 3.');

		await fireEvent.keyDown(plot, { key: 'Home' });
		expect(live.textContent).toBe('Jan 2026: $10.00. 1 of 3.');
		await fireEvent.keyDown(plot, { key: 'ArrowLeft' });
		expect(live.textContent).toBe('Jan 2026: $10.00. 1 of 3.');
	});

	test('Up and Down are left to the page, so it still scrolls', async () => {
		const { plot, live } = await mount();
		const down = new KeyboardEvent('keydown', { key: 'ArrowDown', cancelable: true });
		plot.dispatchEvent(down);
		expect(down.defaultPrevented).toBe(false);
		expect(live.textContent).toBe('');
	});

	test('ArrowLeft from nothing starts at the last bucket', async () => {
		const { plot, live } = await mount();
		await fireEvent.keyDown(plot, { key: 'ArrowLeft' });
		expect(live.textContent).toBe('Mar 2026: $7.00. 3 of 3.');
	});

	test('Escape and blur leave the bucket and hide the tooltip', async () => {
		const { plot, live } = await mount();
		await fireEvent.keyDown(plot, { key: 'ArrowRight' });
		await fireEvent.keyDown(plot, { key: 'Escape' });
		expect(live.textContent).toBe('');
		expect(tooltip.hide).toHaveBeenCalledTimes(1);

		await fireEvent.keyDown(plot, { key: 'ArrowRight' });
		await fireEvent.blur(plot);
		expect(live.textContent).toBe('');
		expect(tooltip.hide).toHaveBeenCalledTimes(2);
	});

	test('Enter selects the focused bucket through onSelect', async () => {
		const onSelect = vi.fn();
		const { plot } = await mount(onSelect);
		await fireEvent.keyDown(plot, { key: 'Enter' });
		expect(onSelect).not.toHaveBeenCalled();
		await fireEvent.keyDown(plot, { key: 'ArrowRight' });
		await fireEvent.keyDown(plot, { key: 'ArrowRight' });
		await fireEvent.keyDown(plot, { key: 'Enter' });
		expect(onSelect).toHaveBeenCalledWith(DATA[1], null);
	});
});
