import { describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';

const vehicleCount = vi.hoisted(() => ({ value: 0 }));

vi.mock('$app/paths', () => ({ resolve: (path: string) => path }));
vi.mock('#lib/components/analytics/fuel/FuelStatsTab.svelte', () => ({ default: () => {} }));
vi.mock('#lib/services/analytics-api.ts', () => ({
	analyticsApi: {
		getSummary: () =>
			Promise.resolve({
				quickStats: {
					vehicleCount: vehicleCount.value,
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

import Page from '../+page.svelte';

describe('analytics with no vehicles', () => {
	test('shows the Add Vehicle empty state instead of zero tiles and tabs', async () => {
		vehicleCount.value = 0;
		const { container } = render(Page);

		await screen.findByRole('heading', { name: 'Add a vehicle first' });
		expect(screen.getByRole('link', { name: 'Add Vehicle' })).toHaveAttribute(
			'href',
			'/vehicles/new'
		);
		expect(screen.queryByRole('tablist')).toBeNull();
		expect(screen.queryByText('Total Vehicles')).toBeNull();
		expect(container.querySelectorAll('[data-slot="card"]')).toHaveLength(1);
	});

	test('with a vehicle the tiles and tabs render as before', async () => {
		vehicleCount.value = 1;
		render(Page);

		expect(await screen.findByText('Total Vehicles')).toBeTruthy();
		expect(screen.getByRole('tablist')).toBeTruthy();
		expect(screen.queryByRole('heading', { name: 'Add a vehicle first' })).toBeNull();
	});
});
