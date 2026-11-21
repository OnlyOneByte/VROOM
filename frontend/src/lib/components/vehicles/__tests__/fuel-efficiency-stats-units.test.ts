import { describe, expect, test, vi } from 'vitest';
import { render } from '@testing-library/svelte';
import type { VehicleStats } from '#lib/types/index.ts';

vi.mock('#lib/stores/settings.svelte.ts', () => ({
	settingsStore: {
		unitPreferences: { distanceUnit: 'miles', volumeUnit: 'gallons_us', chargeUnit: 'kwh' },
		settings: { currencyUnit: 'USD' }
	}
}));

const FuelEfficiencyStatsCard = (await import('../FuelEfficiencyStatsCard.svelte')).default;

const STATS: VehicleStats = {
	period: 'all',
	totalMileage: 1200,
	currentMileage: 46200,
	currentOdometer: 46200,
	totalFuelConsumed: 85,
	totalChargeConsumed: 0,
	averageMpg: 7.1,
	averageMilesPerKwh: null,
	totalFuelCost: 140,
	totalChargeCost: 0,
	costPerMile: 0.12,
	fuelExpenseCount: 3,
	chargeExpenseCount: 0
};

function renderCard(unitPreferences?: {
	distanceUnit: 'miles' | 'kilometers';
	volumeUnit: 'gallons_us' | 'gallons_uk' | 'liters';
	chargeUnit: 'kwh';
}) {
	return render(FuelEfficiencyStatsCard, {
		props: {
			vehicleId: 'veh-1',
			vehicleStatsData: STATS,
			isLoadingStats: false,
			selectedStatsPeriod: 'all',
			unitPreferences
		}
	});
}

describe('FuelEfficiencyStatsCard units', () => {
	test("labels a metric vehicle's stats in its own units, not the user's", () => {
		const { container } = renderCard({
			distanceUnit: 'kilometers',
			volumeUnit: 'liters',
			chargeUnit: 'kwh'
		});
		const text = container.textContent ?? '';

		expect(text).toContain('Current Odometer');
		expect(text).toContain('Kilometers');
		expect(text).toContain('Cost per km');
		expect(text).not.toContain('Miles');
		expect(text).not.toContain('gal');
	});

	test("falls back to the user's units when the vehicle has none", () => {
		const text = renderCard().container.textContent ?? '';

		expect(text).toContain('Current Mileage');
		expect(text).toContain('Cost per mi');
	});
});
