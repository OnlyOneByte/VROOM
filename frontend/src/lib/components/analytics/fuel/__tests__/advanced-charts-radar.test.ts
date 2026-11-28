import { describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import type { FuelAdvancedResponse } from '#lib/types/index.ts';
import AdvancedCharts from '../AdvancedCharts.svelte';

function radarVehicle(vehicleId: string, vehicleName: string, fuelEfficiency: number | null) {
	return {
		vehicleId,
		vehicleName,
		fuelEfficiency,
		maintenanceCost: 50,
		reliability: 50,
		annualCost: 50,
		mileage: 50
	};
}

function advanced(vehicleRadar: FuelAdvancedResponse['vehicleRadar']): FuelAdvancedResponse {
	return {
		maintenanceTimeline: [],
		seasonalEfficiency: [],
		vehicleRadar,
		dayOfWeekPatterns: [],
		monthlyCostHeatmap: [],
		fillupIntervals: []
	} as unknown as FuelAdvancedResponse;
}

describe('Vehicle performance comparison fuel efficiency', () => {
	test('names the vehicles that have no fuel efficiency score', () => {
		render(AdvancedCharts, {
			group: 'comparisons',
			fuelAdvanced: advanced([
				radarVehicle('gas', 'Weekend Car', 50),
				radarVehicle('ev', 'Commuter EV', null)
			])
		});
		expect(screen.getByText(/Fuel efficiency: no data for Commuter EV\./)).toBeTruthy();
	});

	test('says No data when no vehicle has a fuel efficiency score', () => {
		render(AdvancedCharts, {
			group: 'comparisons',
			fuelAdvanced: advanced([
				radarVehicle('a', 'Daily Driver', null),
				radarVehicle('ev', 'Commuter EV', null)
			])
		});
		expect(screen.getByText(/Fuel efficiency: no data\.$/)).toBeTruthy();
	});

	test('adds no note when every vehicle has a score', () => {
		render(AdvancedCharts, {
			group: 'comparisons',
			fuelAdvanced: advanced([
				radarVehicle('a', 'Daily Driver', 10),
				radarVehicle('b', 'Weekend Car', 100)
			])
		});
		expect(screen.queryByText(/Fuel efficiency: no data/)).toBeNull();
		expect(
			screen.getByText('Scores from 10 (worst in your fleet) to 100 (best), by metric.')
		).toBeTruthy();
	});
});
