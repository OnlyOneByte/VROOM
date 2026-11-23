import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import { unitTooltip } from '#lib/utils/chart-formatters.ts';

const { rules } = vi.hoisted(() => ({ rules: [] as { y: unknown; style: unknown }[] }));

vi.mock('layerchart', () => ({
	LineChart: (anchor: unknown, props: { aboveMarks?: (anchor: unknown) => void }) => {
		props.aboveMarks?.(anchor);
	},
	Points: () => {},
	Rule: (_anchor: unknown, props: { y: unknown; style: unknown }) => {
		rules.push({ y: props.y, style: props.style });
	},
	Tooltip: { Root: () => {} },
	getChartContext: () => ({})
}));

const { default: AppLineChart } = await import('../AppLineChart.svelte');
const { default: ChartCard } = await import('../ChartCard.svelte');

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

const text = (id: string, body: string) =>
	createRawSnippet(() => ({ render: () => `<p data-testid="${id}">${body}</p>` }));

const EFFICIENCY = {
	title: 'Fuel Efficiency',
	data: [
		{ date: new Date(2026, 0, 1), efficiency: 30 },
		{ date: new Date(2026, 1, 1), efficiency: 33 }
	],
	x: 'date',
	y: 'efficiency',
	series: [{ key: 'efficiency', label: 'Efficiency', color: 'var(--chart-2)' }],
	config: { efficiency: { label: 'Efficiency', color: 'var(--chart-2)' } }
};

async function settle() {
	for (let i = 0; i < 10; i++) await new Promise(r => setTimeout(r, 0));
}

afterEach(() => {
	cleanup();
	rules.length = 0;
	vi.unstubAllGlobals();
});

describe('AppLineChart reference lines', () => {
	test('a dashed average is named in the legend and in the chart summary', async () => {
		vi.stubGlobal('IntersectionObserver', VisibleIntersectionObserver);
		const mpg = unitTooltip('mi/gal');
		render(AppLineChart, {
			props: {
				title: 'Fuel Efficiency',
				data: [
					{ date: new Date(2026, 0, 1), efficiency: 30 },
					{ date: new Date(2026, 1, 1), efficiency: 33 }
				],
				x: 'date',
				y: 'efficiency',
				series: [{ key: 'efficiency', label: 'Efficiency', color: 'var(--chart-2)' }],
				config: { efficiency: { label: 'Efficiency', color: 'var(--chart-2)' } },
				tooltipFormat: mpg,
				referenceLines: [{ value: 31.5, label: 'Average' }]
			}
		});
		await settle();
		const list = screen.getByRole('list', { name: 'Reference lines' });
		expect(within(list).getByRole('listitem')).toHaveTextContent('Average: 31.5 mi/gal');
		expect(screen.getByRole('img').getAttribute('aria-label')).toMatch(
			/Lowest: Jan 2026, 30\.0 mi\/gal\. Average: 31\.5 mi\/gal\.$/
		);
	});

	test('each line is drawn as a muted dashed rule at its own value', async () => {
		vi.stubGlobal('IntersectionObserver', VisibleIntersectionObserver);
		render(AppLineChart, {
			props: { ...EFFICIENCY, referenceLines: [{ value: 31.5, label: 'Average' }] }
		});
		await settle();
		expect(rules).toEqual([{ y: 31.5, style: expect.stringContaining('var(--muted-foreground)') }]);
	});

	test('two lines with the same label both render instead of throwing', async () => {
		vi.stubGlobal('IntersectionObserver', VisibleIntersectionObserver);
		render(AppLineChart, {
			props: {
				...EFFICIENCY,
				referenceLines: [
					{ value: 30, label: 'Target' },
					{ value: 33, label: 'Target' }
				]
			}
		});
		await settle();
		expect(rules.map(r => r.y)).toEqual([30, 33]);
		const list = screen.getByRole('list', { name: 'Reference lines' });
		expect(within(list).getAllByRole('listitem')).toHaveLength(2);
	});

	test('without reference lines there is no reference legend', async () => {
		vi.stubGlobal('IntersectionObserver', VisibleIntersectionObserver);
		render(AppLineChart, {
			props: {
				title: 'Fuel Efficiency',
				data: [{ date: new Date(2026, 0, 1), efficiency: 30 }],
				x: 'date',
				y: 'efficiency',
				series: [{ key: 'efficiency', label: 'Efficiency', color: 'var(--chart-2)' }],
				config: { efficiency: { label: 'Efficiency', color: 'var(--chart-2)' } }
			}
		});
		await settle();
		expect(screen.queryByRole('list', { name: 'Reference lines' })).toBeNull();
	});
});

describe('ChartCard summary and footer', () => {
	test.each([
		['with data', {}],
		['while loading', { isLoading: true }],
		['when empty', { isEmpty: true }],
		['on error', { error: "Couldn't load" }]
	])(
		'%s, the summary sits above the plot and the footer below, inside the card',
		async (_l, extra) => {
			vi.stubGlobal('IntersectionObserver', VisibleIntersectionObserver);
			const { container } = render(ChartCard, {
				props: {
					title: 'Fuel economy',
					summary: text('summary', '31.4 mi/gal average'),
					footer: text('footer', 'Best month: March'),
					children: text('plot', 'plot'),
					...extra
				}
			});
			await settle();
			const card = container.querySelector('[data-slot="card"]')!;
			const summary = within(card as HTMLElement).getByTestId('summary');
			const footer = within(card as HTMLElement).getByTestId('footer');
			expect(
				summary.compareDocumentPosition(footer) & Node.DOCUMENT_POSITION_FOLLOWING
			).toBeTruthy();
			const plot = within(card as HTMLElement).queryByTestId('plot');
			if (plot) {
				expect(
					summary.compareDocumentPosition(plot) & Node.DOCUMENT_POSITION_FOLLOWING
				).toBeTruthy();
				expect(
					plot.compareDocumentPosition(footer) & Node.DOCUMENT_POSITION_FOLLOWING
				).toBeTruthy();
			}
		}
	);
});
