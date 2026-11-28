import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';

const mocks = vi.hoisted(() => ({
	query: vi.fn(),
	summary: vi.fn(),
	url: new URL('https://vroom.test/analytics')
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
vi.mock('#lib/components/analytics/explore/explore-bar-chart.ts', () => ({
	AppBarChart: () => {}
}));
vi.mock('#lib/components/analytics/explore/explore-line-chart.ts', () => ({
	AppLineChart: () => {}
}));
vi.mock('#lib/services/vehicle-api.ts', () => ({
	vehicleApi: {
		getVehicles: () =>
			Promise.resolve([
				{ id: 'civic', year: 2019, make: 'Honda', model: 'Civic' },
				{ id: 'rav4', year: 2022, make: 'Toyota', model: 'RAV4' }
			])
	}
}));
vi.mock('#lib/services/analytics-api.ts', () => ({
	analyticsApi: {
		query: mocks.query,
		insights: () => new Promise(() => {}),
		getSummary: mocks.summary
	},
	getDefaultDateRange: () => ({ startDate: 1, endDate: 2, ytdStart: 1 })
}));

import Page from '../+page.svelte';

let releaseSummary: (value: unknown) => void = () => {};

beforeAll(async () => {
	await import('#lib/components/analytics/explore/ExploreTab.svelte');
}, 60_000);

beforeEach(() => {
	mocks.url = new URL('https://vroom.test/analytics');
	mocks.query.mockReset();
	mocks.query.mockReturnValue(new Promise(() => {}));
	mocks.summary.mockReset();
	mocks.summary.mockReturnValue(new Promise(resolve => (releaseSummary = resolve)));
});

const SUMMARY = {
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
};

describe('the Explore query on page load', () => {
	test('starts alongside the summary, and Explore uses it instead of sending a second one', async () => {
		render(Page);
		await waitFor(() => expect(mocks.query).toHaveBeenCalledTimes(1));
		expect(mocks.summary).toHaveBeenCalledTimes(1);

		releaseSummary(SUMMARY);
		expect(await screen.findByLabelText('Loading the chart')).toBeTruthy();
		expect(mocks.query).toHaveBeenCalledTimes(1);
	});

	test('leaving Explore for another tab sends no further Explore query', async () => {
		render(Page);
		releaseSummary(SUMMARY);
		await screen.findByLabelText('Loading the chart');

		await fireEvent.click(screen.getByRole('tab', { name: 'Fuel & charging' }));
		await screen.findByRole('heading', { name: 'Fuel & charging' });
		expect(mocks.query).toHaveBeenCalledTimes(1);
	});

	test('with cars and a range in the URL, Explore still matches the prefetch and sends nothing more', async () => {
		mocks.url = new URL('https://vroom.test/analytics?range=3m&cars=rav4,civic');
		render(Page);
		await waitFor(() => expect(mocks.query).toHaveBeenCalledTimes(1));
		expect(mocks.query.mock.calls[0]?.[0]).toMatchObject({ vehicleIds: ['rav4', 'civic'] });

		releaseSummary(SUMMARY);
		await screen.findByLabelText('Loading the chart');
		expect(mocks.query).toHaveBeenCalledTimes(1);
	});

	test('with no vehicles, the prefetch is cancelled once the summary says so', async () => {
		render(Page);
		await waitFor(() => expect(mocks.query).toHaveBeenCalledTimes(1));
		const signal = (mocks.query.mock.calls[0]?.[1] as { signal: AbortSignal }).signal;
		expect(signal.aborted).toBe(false);

		releaseSummary({ ...SUMMARY, quickStats: { ...SUMMARY.quickStats, vehicleCount: 0 } });
		await waitFor(() => expect(signal.aborted).toBe(true));
		expect(mocks.query).toHaveBeenCalledTimes(1);
	});
});
