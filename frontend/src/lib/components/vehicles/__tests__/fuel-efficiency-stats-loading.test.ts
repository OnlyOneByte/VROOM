import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render } from '@testing-library/svelte';
import type { VehicleStats } from '#lib/types/index.ts';

vi.mock('$app/paths', () => ({ resolve: (path: string) => path }));
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
	averageMpg: null,
	averageMilesPerKwh: null,
	totalFuelCost: 140,
	totalChargeCost: 0,
	costPerMile: 0.12,
	fuelExpenseCount: 3,
	chargeExpenseCount: 0
};

afterEach(() => cleanup());

function mount(vehicleStatsData: VehicleStats | null, isLoadingStats: boolean) {
	return render(FuelEfficiencyStatsCard, {
		props: { vehicleId: 'veh-1', vehicleStatsData, isLoadingStats, selectedStatsPeriod: 'all' }
	});
}

function tiles(container: HTMLElement): Element[] {
	return [...container.querySelectorAll('[data-slot="card"]')];
}

function isTwoValueSkeleton(tile: Element): boolean {
	const halves = tile.querySelector('[class~="@sm:flex-row"]');
	return (
		halves !== null &&
		halves.querySelectorAll('[data-slot="skeleton"]').length === 6 &&
		halves.querySelector('.bg-border') !== null
	);
}

describe('Mileage & Fuel Statistics while the stats load', () => {
	test('the first load shows three two-value skeleton tiles without a duplicate-key error', () => {
		const { container } = mount(null, true);

		expect(tiles(container)).toHaveLength(3);
		for (const tile of tiles(container)) expect(isTwoValueSkeleton(tile)).toBe(true);
	});

	test('a reload keeps one two-value skeleton per tile already on screen', () => {
		const { container } = mount(STATS, false);
		expect(tiles(container)).toHaveLength(2);

		cleanup();
		const reloading = mount(STATS, true).container;
		expect(tiles(reloading)).toHaveLength(2);
		for (const tile of tiles(reloading)) expect(isTwoValueSkeleton(tile)).toBe(true);
		expect(reloading.textContent).not.toContain('46,200');
	});
});
