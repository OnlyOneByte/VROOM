import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/svelte';
import type { ChartState } from 'layerchart';
import type { ChartAnnotations } from '../types.ts';

vi.mock('layerchart', () => ({
	LineChart: () => {},
	BarChart: () => {},
	Points: () => {},
	Rule: () => {},
	Tooltip: { Root: () => {} },
	getChartContext: () => ({})
}));

const { default: AnnotationLane } = await import('../AnnotationLane.svelte');
const { default: AppLineChart } = await import('../AppLineChart.svelte');
await import('../EventsTable.svelte');

const JAN = new Date(Date.UTC(2026, 0, 1));
const FEB = new Date(Date.UTC(2026, 1, 1));
const ANNOTATIONS: ChartAnnotations = {
	label: 'Services',
	formatAt: at => (at instanceof Date && at.getUTCMonth() === 0 ? 'Jan 2026' : 'Feb 2026'),
	markers: [
		{ at: JAN, label: 'Oil change', detail: 'Camry, $75.00' },
		{ at: FEB, label: '2 services', detail: 'Brakes $300.00, Tires $640.00' }
	],
	density: [
		{ at: JAN, value: 1, label: '1 trip, 20 mi' },
		{ at: FEB, value: 0, label: 'No trips' }
	]
};

const CONTEXT = {
	xScale: (at: unknown) => (at === JAN ? 0 : at === FEB ? 100 : undefined),
	padding: { top: 0, right: 0, bottom: 0, left: 10 }
} as unknown as ChartState<Record<string, unknown>>;

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

const MONTHS = [0, 1, 2, 3].map(m => new Date(Date.UTC(2026, m, 1)));
const MONTH_NAMES = ['Jan 2026', 'Feb 2026', 'Mar 2026', 'Apr 2026'];

function narrowContext(step: number) {
	return {
		xScale: (at: unknown) => MONTHS.findIndex(m => m === at) * step,
		padding: { top: 0, right: 0, bottom: 0, left: 10 }
	} as unknown as ChartState<Record<string, unknown>>;
}

function crowded(): ChartAnnotations {
	return {
		...ANNOTATIONS,
		density: [],
		formatAt: at => MONTH_NAMES[MONTHS.findIndex(m => m === at)] ?? '',
		markers: MONTHS.map((at, i) => ({ at, label: `Service ${i + 1}` }))
	};
}

async function settle() {
	for (let i = 0; i < 10; i++) await new Promise(r => setTimeout(r, 0));
}

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe('AnnotationLane', () => {
	test('places hollow markers and a density strip on the chart x scale', () => {
		const { container } = render(AnnotationLane, {
			props: { annotations: ANNOTATIONS, context: CONTEXT }
		});
		const markers = container.querySelectorAll<HTMLElement>('[data-annotation-marker]');
		expect([...markers].map(m => m.style.left)).toEqual(['10px', '110px']);
		const strip = container.querySelectorAll('[title="1 trip, 20 mi"]');
		expect(strip).toHaveLength(1);
		expect(container.querySelector('[title="No trips"]')).toBeNull();
	});

	test('one tab stop; arrow keys step through markers and announce them', async () => {
		render(AnnotationLane, { props: { annotations: ANNOTATIONS, context: CONTEXT } });
		const lane = screen.getByRole('group', {
			name: 'Services: 2 markers. Use the arrow keys to step through them. The strip under them is listed in Table view.'
		});
		expect(lane.tabIndex).toBe(0);
		await fireEvent.keyDown(lane, { key: 'ArrowRight' });
		expect(screen.getByText('Jan 2026: Oil change. Camry, $75.00 1 of 2.')).toBeInTheDocument();
		await fireEvent.keyDown(lane, { key: 'End' });
		expect(
			screen.getByText('Feb 2026: 2 services. Brakes $300.00, Tires $640.00 2 of 2.')
		).toBeInTheDocument();
		expect(screen.getByText('Brakes $300.00, Tires $640.00')).toBeInTheDocument();
		await fireEvent.keyDown(lane, { key: 'Escape' });
		expect(screen.queryByText(/2 of 2/)).toBeNull();
	});

	test('the tooltip stays inside the lane at either edge, and a note is read out', async () => {
		const { container } = render(AnnotationLane, {
			props: {
				annotations: { ...ANNOTATIONS, note: 'Only the latest are shown.' },
				context: CONTEXT
			}
		});
		const lane = screen.getByRole('group', { name: /Only the latest are shown\.$/ });
		expect(screen.getByText('Only the latest are shown.', { selector: 'p' })).toBeVisible();
		Object.defineProperty(lane, 'clientWidth', { configurable: true, value: 120 });
		await fireEvent.keyDown(lane, { key: 'End' });
		const tip = container.querySelector<HTMLElement>('.bg-popover');
		expect(tip).not.toBeNull();
		expect(Number.parseFloat(tip?.style.left ?? 'NaN')).toBeGreaterThanOrEqual(0);
	});

	test('months closer than 24px to the drawn marker share one marker', async () => {
		const { container } = render(AnnotationLane, {
			props: { annotations: crowded(), context: narrowContext(15) }
		});
		const shown = [...container.querySelectorAll<HTMLElement>('[data-annotation-marker]')];
		expect(shown.map(m => [m.style.left, m.textContent?.trim() ?? ''])).toEqual([
			['25px', '3'],
			['55px', '']
		]);

		const lane = screen.getByRole('group', { name: /^Services: 4 markers\./ });
		await fireEvent.keyDown(lane, { key: 'ArrowRight' });
		await fireEvent.keyDown(lane, { key: 'ArrowRight' });
		expect(screen.getByText('Feb 2026: Service 2. 2 of 4.')).toBeInTheDocument();
		expect(shown[0]?.className).toContain('ring-2');
		expect(shown[1]?.className).not.toContain('ring-2');
	});

	test('the count is the number of services, not of months', () => {
		const annotations = crowded();
		annotations.markers = annotations.markers?.map((m, i) =>
			i === 0 ? { ...m, label: '3 services', rows: ['A', 'B', 'C'] } : m
		);
		const { container } = render(AnnotationLane, {
			props: { annotations, context: narrowContext(15) }
		});
		expect(container.querySelector('[data-annotation-group]')?.textContent?.trim()).toBe('5');
	});

	test('tapping a group lists every month in it', async () => {
		const { container } = render(AnnotationLane, {
			props: { annotations: crowded(), context: narrowContext(15) }
		});
		const group = container.querySelector<HTMLElement>('[data-annotation-group]');
		await fireEvent.click(group as HTMLElement);
		const rows = [...(container.querySelector('[data-annotation-group-tip]')?.children ?? [])];
		expect(rows.map(r => r.textContent?.replace(/\s+/g, ' ').trim())).toEqual([
			'Jan 2026: Service 1',
			'Feb 2026: Service 2',
			'Mar 2026: Service 3'
		]);
	});

	test('a group near the right edge stays inside the lane', async () => {
		vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(30);
		vi.stubGlobal(
			'ResizeObserver',
			class {
				constructor(private readonly cb: (entries: unknown[], observer: unknown) => void) {}
				observe(target: Element) {
					queueMicrotask(() => this.cb([{ target, contentRect: { width: 30 } }], this));
				}
				unobserve() {}
				disconnect() {}
			}
		);
		const { container } = render(AnnotationLane, {
			props: { annotations: crowded(), context: narrowContext(15) }
		});
		await settle();
		const group = container.querySelector<HTMLElement>('[data-annotation-group]');
		expect(Number.parseFloat(group?.style.left ?? 'NaN')).toBe(30 - 12);
	});

	test('a lane with no markers is not a tab stop', () => {
		render(AnnotationLane, {
			props: { annotations: { ...ANNOTATIONS, markers: [] }, context: CONTEXT }
		});
		expect(
			screen.getByRole('group', {
				name: 'Services: 0 markers. The strip under them is listed in Table view.'
			}).tabIndex
		).toBe(-1);
	});
});

describe('a chart with annotations', () => {
	test('draws the lane above the plot and lists the events in Table view', async () => {
		vi.stubGlobal('IntersectionObserver', VisibleIntersectionObserver);
		render(AppLineChart, {
			title: 'Cost per month',
			data: [
				{ date: JAN, fuel: 40 },
				{ date: FEB, fuel: 42 }
			],
			x: 'date',
			y: 'fuel',
			series: [{ key: 'fuel', label: 'Fuel', color: 'var(--chart-1)' }],
			config: { fuel: { label: 'Fuel', color: 'var(--chart-1)' } },
			annotations: ANNOTATIONS
		});
		await settle();
		expect(await screen.findByRole('group', { name: /Services: 2 markers/ })).toBeInTheDocument();
		await fireEvent.click(screen.getByRole('button', { name: 'Table' }));
		await settle();
		const events = await screen.findByRole('region', { name: 'Cost per month: Services' });
		const rows = within(events).getAllByRole('row');
		expect(rows.map(r => r.textContent?.replace(/\s+/g, ' ').trim())).toEqual([
			'When Services',
			'Jan 2026 Oil change: Camry, $75.00',
			'Jan 2026 1 trip, 20 mi',
			'Feb 2026 2 services: Brakes $300.00, Tires $640.00'
		]);
	});
});
