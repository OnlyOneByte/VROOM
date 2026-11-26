import { describe, expect, test, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/svelte';
import { flushSync } from 'svelte';
import { page } from './page-state.svelte.ts';

const getSummary = vi.hoisted(() => vi.fn());

vi.mock('$app/state', () => ({ page }));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('#lib/components/analytics/explore/ExploreTab.svelte', () => ({ default: () => {} }));
vi.mock('#lib/services/vehicle-api.ts', () => ({ vehicleApi: { getVehicles: () => Promise.resolve([]) } }));
vi.mock('#lib/services/analytics-api.ts', () => ({
	analyticsApi: { getSummary },
	getDefaultDateRange: () => ({ startDate: 1, endDate: 2, ytdStart: 1 })
}));

const { default: Page } = await import('../+page.svelte');

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

describe('analytics reloading for a new filter', () => {
	test('keeps the tabs in place and adds no skeleton while the new summary loads', async () => {
		getSummary.mockResolvedValueOnce(SUMMARY);
		const { container } = render(Page);
		await screen.findByRole('tablist');

		getSummary.mockReturnValueOnce(new Promise(() => {}));
		page.url = new URL('https://vroom.test/analytics?range=3m');
		flushSync();
		await waitFor(() => expect(getSummary).toHaveBeenCalledTimes(2));

		expect(screen.getByRole('tablist')).toBeInTheDocument();
		expect(container.querySelector('[data-slot="skeleton"]')).toBeNull();
	});
});
