import { beforeEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';

const mocks = vi.hoisted(() => ({
	query: vi.fn(),
	summary: vi.fn()
}));

vi.mock('$app/paths', () => ({ resolve: (path: string) => path }));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$app/state', () => ({ page: { url: new URL('https://vroom.test/analytics') } }));
vi.mock('#lib/components/analytics/fuel/FuelStatsTab.svelte', () => ({ default: () => {} }));
vi.mock('#lib/services/vehicle-api.ts', () => ({
	vehicleApi: { getVehicles: () => Promise.resolve([]) }
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

beforeEach(() => {
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
		expect(
			await screen.findByLabelText('Loading the chart', undefined, { timeout: 10_000 })
		).toBeTruthy();
		expect(mocks.query).toHaveBeenCalledTimes(1);
	});

	test('leaving Explore for another tab sends no further Explore query', async () => {
		render(Page);
		releaseSummary(SUMMARY);
		await screen.findByLabelText('Loading the chart', undefined, { timeout: 10_000 });

		await fireEvent.click(screen.getByRole('tab', { name: 'Fuel & charging' }));
		await screen.findByRole('heading', { name: 'Fuel & charging' });
		expect(mocks.query).toHaveBeenCalledTimes(1);
	});
});
