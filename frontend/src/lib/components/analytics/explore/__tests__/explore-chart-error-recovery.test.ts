import { describe, expect, test, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/svelte';
import type { AnalyticsQueryResponse } from '#lib/types/index.ts';
import { DEFAULT_EXPLORE, type ExploreQuery } from '../query-state';

const mocks = vi.hoisted(() => ({ lineRequested: vi.fn() }));

vi.mock('$app/paths', () => ({ resolve: (path: string) => path }));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$app/state', () => ({ page: { url: new URL('https://vroom.test/analytics') } }));
vi.mock('../explore-bar-chart.ts', () => ({ AppBarChart: () => {} }));
vi.mock('../explore-line-chart.ts', () => {
	mocks.lineRequested();
	if (mocks.lineRequested.mock.calls.length === 1) throw new Error('chunk failed to load');
	return { AppLineChart: () => {} };
});

function response(metric: string): AnalyticsQueryResponse {
	return {
		metric,
		unit: 'USD',
		interval: 'month',
		groupBy: 'category',
		range: { start: 0, end: 1 },
		buckets: ['2025-01', '2025-02'],
		series: [{ key: 'fuel', label: 'Fuel', values: [100, 50] }],
		totals: { value: 150, perBucket: 75, perDistance: 0.5, distance: 300 },
		compare: null
	} as unknown as AnalyticsQueryResponse;
}

vi.mock('#lib/services/analytics-api.ts', () => ({
	analyticsApi: {
		query: (request: { metric: string }) => Promise.resolve(response(request.metric)),
		insights: () => new Promise(() => {})
	},
	getDefaultDateRange: () => ({ startDate: 1, endDate: 2, ytdStart: 1 })
}));

const ExploreTab = (await import('../ExploreTab.svelte')).default;

const LINE: ExploreQuery = { ...DEFAULT_EXPLORE, metric: 'costPerDistance' };
const props = (query: ExploreQuery) => ({
	query,
	onQueryChange: () => {},
	dateRange: { startDate: 1, endDate: 2, ytdStart: 1 } as never
});

describe('a chart load error', () => {
	test('clears once the background warm-up loads that chart', async () => {
		const { rerender } = render(ExploreTab, props(LINE));
		expect(await screen.findByText("Couldn't load this chart")).toBeInTheDocument();

		await rerender(props(DEFAULT_EXPLORE));
		await waitFor(() => expect(screen.queryByText("Couldn't load this chart")).toBeNull());
		await waitFor(() => expect(mocks.lineRequested).toHaveBeenCalledTimes(2), { timeout: 5000 });

		await rerender(props(LINE));
		await waitFor(() => expect(screen.queryByLabelText('Loading the chart')).toBeNull());
		expect(screen.queryByText("Couldn't load this chart")).toBeNull();
	}, 20_000);
});
