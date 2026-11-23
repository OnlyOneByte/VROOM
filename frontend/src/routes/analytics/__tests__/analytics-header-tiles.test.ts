import { describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';

const quick = vi.hoisted(() => ({ costPerDistance: 0.21 as number | null }));

vi.mock('$app/paths', () => ({ resolve: (path: string) => path }));
vi.mock('#lib/components/analytics/fuel/FuelStatsTab.svelte', () => ({ default: () => {} }));
vi.mock('#lib/services/analytics-api.ts', () => ({
	analyticsApi: {
		getSummary: () =>
			Promise.resolve({
				quickStats: {
					vehicleCount: 2,
					ytdSpending: 633,
					avgEfficiency: 30.2,
					costPerDistance: quick.costPerDistance,
					fleetHealthScore: 38,
					units: { distanceUnit: 'miles', volumeUnit: 'gallons_us', chargeUnit: 'kwh' }
				},
				fuelStats: null,
				fuelAdvanced: null
			})
	},
	getDefaultDateRange: () => ({})
}));

import Page from '../+page.svelte';

describe('analytics header tiles', () => {
	test('show cost per distance for all costs instead of the average efficiency', async () => {
		quick.costPerDistance = 0.21;
		render(Page);

		expect(await screen.findByText('Cost per mi')).toBeTruthy();
		expect(screen.getByText('$0.21')).toBeTruthy();
		expect(screen.queryByText('Avg mi/gal')).toBeNull();
	});

	test('show N/A when there is no distance to divide by', async () => {
		quick.costPerDistance = null;
		render(Page);

		expect(await screen.findByText('Cost per mi')).toBeTruthy();
		expect(screen.getByText('N/A')).toBeTruthy();
	});
});
