import { beforeEach, describe, expect, test, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/svelte';

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

describe('analytics with a car but nothing logged', () => {
	test('explains itself and offers the first expense instead of the measure controls', async () => {
		render(Page);

		expect(
			await screen.findByRole('heading', { name: 'Nothing to explore yet' })
		).toBeInTheDocument();
		expect(screen.getByRole('link', { name: 'Add first expense' })).toHaveAttribute(
			'href',
			'/expenses/new'
		);
		expect(screen.queryByRole('tablist')).toBeNull();
		expect(screen.getByRole('heading', { level: 1, name: 'Explore' })).toBeInTheDocument();
		expect(getExpenseSummary).toHaveBeenCalledWith({ period: 'all' });
	});

	test('once anything is logged, the tabs show as usual', async () => {
		getExpenseSummary.mockResolvedValue({ expenseCount: 1 });
		render(Page);

		expect(await screen.findByRole('tablist')).toBeTruthy();
		await waitFor(() => expect(getExpenseSummary).toHaveBeenCalled());
		expect(screen.queryByRole('heading', { name: 'Nothing to explore yet' })).toBeNull();
	});

	test('a car shared with me may have data of its own, so the tabs stay', async () => {
		getVehicles.mockResolvedValue([OWN, SHARED]);
		render(Page);

		expect(await screen.findByRole('tablist')).toBeTruthy();
		await waitFor(() => expect(getVehicles).toHaveBeenCalled());
		expect(screen.queryByRole('heading', { name: 'Nothing to explore yet' })).toBeNull();
	});

	test('if the count cannot load, the page makes no claim and shows the tabs', async () => {
		getExpenseSummary.mockRejectedValue(new Error('offline'));
		render(Page);

		expect(await screen.findByRole('tablist')).toBeTruthy();
		expect(screen.queryByRole('heading', { name: 'Nothing to explore yet' })).toBeNull();
	});
});
