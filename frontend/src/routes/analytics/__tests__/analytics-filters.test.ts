import { beforeEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';

const mocks = vi.hoisted(() => ({
	url: new URL('https://vroom.test/analytics'),
	goto: vi.fn(),
	getSummary: vi.fn()
}));

vi.mock('$app/paths', () => ({ resolve: (path: string) => path }));
vi.mock('$app/navigation', () => ({ goto: mocks.goto }));
vi.mock('$app/state', () => ({
	page: {
		get url() {
			return mocks.url;
		}
	}
}));
vi.mock('#lib/components/analytics/fuel/FuelStatsTab.svelte', () => ({ default: () => {} }));
vi.mock('#lib/components/analytics/explore/ExploreTab.svelte', async () => ({
	default: (await import('./ExploreStub.svelte')).default
}));
vi.mock('#lib/services/vehicle-api.ts', () => ({
	vehicleApi: {
		getVehicles: () =>
			Promise.resolve([
				{ id: 'civic', year: 2019, make: 'Honda', model: 'Civic' },
				{ id: 'rav4', year: 2022, make: 'Toyota', model: 'RAV4', nickname: 'Family' }
			])
	}
}));
vi.mock('#lib/services/analytics-api.ts', () => ({
	analyticsApi: { query: () => new Promise(() => {}), getSummary: mocks.getSummary },
	getDefaultDateRange: () => ({ startDate: 1, endDate: 2, ytdStart: 1 })
}));

import Page from '../+page.svelte';

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

beforeEach(() => {
	mocks.goto.mockReset();
	mocks.getSummary.mockReset();
	mocks.getSummary.mockResolvedValue(SUMMARY);
});

describe('analytics filter bar', () => {
	test('the URL range and cars reach the summary request and the buttons', async () => {
		mocks.url = new URL('https://vroom.test/analytics?range=3m&cars=rav4,gone');
		render(Page);

		await waitFor(() => expect(mocks.getSummary).toHaveBeenCalled());
		const params = mocks.getSummary.mock.calls.at(-1)?.[0];
		expect(params.vehicleIds).toEqual(['rav4']);
		const now = new Date();
		const threeMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 3, now.getDate());
		expect(params.startDate).toBe(Math.floor(threeMonthsAgo.getTime() / 1000));
		expect(await screen.findByRole('button', { name: /Last 3 months/ })).toBeTruthy();
		expect(screen.getByRole('button', { name: /2022 Toyota RAV4 \(Family\)/ })).toBeTruthy();
	});

	test('Clear filters goes back to the bare URL', async () => {
		mocks.url = new URL('https://vroom.test/analytics?range=ytd&cars=civic');
		render(Page);

		await fireEvent.click(await screen.findByRole('button', { name: 'Clear filters' }));
		expect(mocks.goto).toHaveBeenCalledWith('/analytics', { reset: false });
	});

	test('the default view sends no car filter and offers no Clear filters', async () => {
		mocks.url = new URL('https://vroom.test/analytics');
		render(Page);

		await waitFor(() => expect(mocks.getSummary).toHaveBeenCalled());
		expect(mocks.getSummary.mock.calls.at(-1)?.[0].vehicleIds).toBeUndefined();
		expect(await screen.findByRole('button', { name: /Last 12 months/ })).toBeTruthy();
		expect(screen.queryByRole('button', { name: 'Clear filters' })).toBeNull();
	});

	test('choosing a preset writes it into the URL', async () => {
		mocks.url = new URL('https://vroom.test/analytics?cars=civic');
		render(Page);

		await fireEvent.click(await screen.findByRole('button', { name: /Last 12 months/ }));
		await fireEvent.click(
			await screen.findByRole('radio', { name: 'Last 24 months' }, { timeout: 10_000 })
		);
		expect(mocks.goto).toHaveBeenCalledWith('/analytics?range=24m&cars=civic', { reset: false });
	});
});

describe('analytics filter bar recovery', () => {
	test('car ids that match none of your cars are dropped from the URL', async () => {
		mocks.url = new URL('https://vroom.test/analytics?range=3m&cars=gone');
		render(Page);

		await waitFor(() =>
			expect(mocks.goto).toHaveBeenCalledWith('/analytics?range=3m', {
				replace: true,
				reset: false
			})
		);
		expect(mocks.getSummary.mock.calls.at(-1)?.[0].vehicleIds).toBeUndefined();
	});

	test('Clear filters hands focus to the date range button', async () => {
		mocks.url = new URL('https://vroom.test/analytics?range=ytd');
		render(Page);

		await fireEvent.click(await screen.findByRole('button', { name: 'Clear filters' }));
		await waitFor(() =>
			expect(document.activeElement).toBe(screen.getByRole('button', { name: /Year to date/ }))
		);
	});
});
