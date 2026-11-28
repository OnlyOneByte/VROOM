import { describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import type { AnalyticsQueryResponse } from '#lib/types/index.ts';

const mocks = vi.hoisted(() => ({
	barRequested: vi.fn(),
	lineRequested: vi.fn(),
	url: new URL('https://vroom.test/analytics?metric=costPerDistance')
}));

vi.mock('$app/paths', () => ({ resolve: (path: string) => path }));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$app/state', () => ({
	page: {
		get url() {
			return mocks.url;
		}
	}
}));
vi.mock('#lib/components/analytics/fuel/FuelStatsTab.svelte', () => ({ default: () => {} }));
vi.mock('#lib/components/analytics/explore/explore-bar-chart.ts', () => {
	mocks.barRequested();
	return { AppBarChart: () => {} };
});
vi.mock('#lib/components/analytics/explore/explore-line-chart.ts', () => {
	mocks.lineRequested();
	if (mocks.lineRequested.mock.calls.length <= 2) throw new Error('chunk failed to load');
	return { AppLineChart: () => {} };
});
vi.mock('#lib/services/vehicle-api.ts', () => ({
	vehicleApi: { getVehicles: () => Promise.resolve([]) }
}));

const RESPONSE = {
	metric: 'cost',
	unit: 'USD',
	interval: 'month',
	groupBy: 'category',
	range: { start: 0, end: 1 },
	buckets: ['2025-01', '2025-02'],
	series: [{ key: 'fuel', label: 'Fuel', values: [100, 50] }],
	totals: { value: 150, perBucket: 75, perDistance: null, distance: 0 },
	compare: null
} as unknown as AnalyticsQueryResponse;

vi.mock('#lib/services/analytics-api.ts', () => ({
	analyticsApi: {
		query: () => Promise.resolve(RESPONSE),
		insights: () => new Promise(() => {}),
		getSummary: () =>
			Promise.resolve({
				quickStats: {
					vehicleCount: 1,
					ytdSpending: 10,
					avgEfficiency: null,
					costPerDistance: null,
					fleetHealthScore: 50,
					units: { distanceUnit: 'miles', volumeUnit: 'gallons_us', chargeUnit: 'kwh' }
				},
				fuelStats: null,
				fuelAdvanced: null
			})
	},
	getDefaultDateRange: () => ({ startDate: 1, endDate: 2, ytdStart: 1 })
}));

import Page from '../+page.svelte';

describe("Explore's chart code", () => {
	test('a line view opened by URL prefetches the line chart, and a failed load offers Retry', async () => {
		render(Page);

		expect(await screen.findByText("Couldn't load this chart")).toBeInTheDocument();
		await fireEvent.click(screen.getByRole('button', { name: /Retry/ }));

		await waitFor(() => expect(screen.queryByText("Couldn't load this chart")).toBeNull());
		await waitFor(() => expect(screen.queryByLabelText('Loading the chart')).toBeNull());
		expect(mocks.lineRequested).toHaveBeenCalledTimes(3);
	});
});
