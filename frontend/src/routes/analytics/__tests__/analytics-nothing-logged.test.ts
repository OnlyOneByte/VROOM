import { beforeEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';

vi.mock('$app/paths', () => ({ resolve: (path: string) => path }));
vi.mock('#lib/components/analytics/explore/ExploreTab.svelte', async () => ({
	default: (await import('./ExploreStub.svelte')).default
}));
vi.mock('#lib/services/analytics-api.ts', () => ({
	analyticsApi: {
		query: () => new Promise(() => {}),
		getSummary: () =>
			Promise.resolve({
				quickStats: {
					vehicleCount: 1,
					ytdSpending: 0,
					avgEfficiency: null,
					costPerDistance: null,
					fleetHealthScore: 0,
					units: { distanceUnit: 'miles', volumeUnit: 'gallons_us', chargeUnit: 'kwh' }
				},
				fuelStats: null,
				fuelAdvanced: null
			})
	},
	getDefaultDateRange: () => ({})
}));

const OWN = { id: 'own', year: 2021, make: 'Toyota', model: 'Corolla' };
const SHARED = { id: 'shared', year: 2020, make: 'Ford', model: 'F-150', sharedAccess: {} };
const getVehicles = vi.hoisted(() => vi.fn());
const getExpenseSummary = vi.hoisted(() => vi.fn());
vi.mock('#lib/services/vehicle-api.ts', () => ({ vehicleApi: { getVehicles } }));
vi.mock('#lib/services/expense-api.ts', () => ({ expenseApi: { getExpenseSummary } }));

const { default: Page } = await import('../+page.svelte');

beforeEach(() => {
	vi.clearAllMocks();
	getVehicles.mockResolvedValue([OWN]);
	getExpenseSummary.mockResolvedValue({ expenseCount: 0 });
});

/** Wait until both loads the decision rests on have settled, so a "no" is a real no. */
async function settled() {
	await waitFor(() => expect(getExpenseSummary).toHaveBeenCalled());
	await waitFor(() => expect(getVehicles).toHaveBeenCalled());
	await Promise.allSettled([
		...getExpenseSummary.mock.results.map(r => r.value),
		...getVehicles.mock.results.map(r => r.value)
	]);
	await tick();
}

describe('analytics with a car but nothing logged', () => {
	test('the Explore tab explains itself and offers the first expense instead of the measures', async () => {
		render(Page);

		expect(
			await screen.findByRole('heading', { name: 'Nothing to explore yet' })
		).toBeInTheDocument();
		expect(screen.getByRole('link', { name: 'Add first expense' })).toHaveAttribute(
			'href',
			'/expenses/new'
		);
		expect(screen.getByRole('heading', { level: 1, name: 'Explore' })).toBeInTheDocument();
		expect(getExpenseSummary).toHaveBeenCalledWith({ period: 'all' });
	});

	test('the other tabs stay, since loans, insurance and trips need no expense', async () => {
		render(Page);
		await screen.findByRole('heading', { name: 'Nothing to explore yet' });

		await fireEvent.click(screen.getByRole('tab', { name: 'Year in review' }));
		expect(screen.getByRole('heading', { level: 1, name: 'Year in review' })).toBeInTheDocument();
		expect(screen.queryByRole('heading', { name: 'Nothing to explore yet' })).toBeNull();
	});

	test('once anything is logged, Explore shows as usual', async () => {
		getExpenseSummary.mockResolvedValue({ expenseCount: 1 });
		render(Page);
		await settled();

		expect(screen.getByRole('tablist')).toBeTruthy();
		expect(screen.queryByRole('heading', { name: 'Nothing to explore yet' })).toBeNull();
	});

	test('a car shared with me may have data of its own, so Explore shows as usual', async () => {
		getVehicles.mockResolvedValue([OWN, SHARED]);
		render(Page);
		await settled();

		expect(screen.queryByRole('heading', { name: 'Nothing to explore yet' })).toBeNull();
	});

	test('if the count cannot load, the page makes no claim and Explore shows as usual', async () => {
		getExpenseSummary.mockRejectedValue(new Error('offline'));
		render(Page);
		await settled();

		expect(screen.queryByRole('heading', { name: 'Nothing to explore yet' })).toBeNull();
	});
});
