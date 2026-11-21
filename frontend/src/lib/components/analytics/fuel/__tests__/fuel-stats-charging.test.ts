import { describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import type { FuelAdvancedResponse, FuelStatsResponse } from '#lib/types/index.ts';
import FuelStatsTab from '../FuelStatsTab.svelte';

const zero = { currentYear: 0, previousYear: 0, currentMonth: 0, previousMonth: 0 };

function stats(over: Partial<FuelStatsResponse>): FuelStatsResponse {
	return {
		fillups: zero,
		volume: zero,
		fuelConsumption: { avgEfficiency: null, bestEfficiency: null, worstEfficiency: null },
		fillupDetails: { avgVolume: null, minVolume: null, maxVolume: null },
		averageCost: {
			perFillup: null,
			bestCostPerDistance: null,
			worstCostPerDistance: null,
			avgCostPerDay: null
		},
		distance: { totalDistance: 0, avgPerDay: null, avgPerMonth: null },
		monthlyConsumption: [],
		gasPriceHistory: [],
		fillupCostByVehicle: [],
		odometerProgression: [],
		costPerDistance: [],
		units: { distanceUnit: 'miles', volumeUnit: 'gallons_us', chargeUnit: 'kwh' },
		...over
	};
}

const advanced = {
	maintenanceTimeline: [],
	seasonalEfficiency: [],
	vehicleRadar: [],
	dayOfWeekPatterns: [],
	monthlyCostHeatmap: [],
	fillupIntervals: []
} as unknown as FuelAdvancedResponse;

const charging: NonNullable<FuelStatsResponse['charging']> = {
	sessions: { currentYear: 3, previousYear: 1, currentMonth: 1, previousMonth: 0 },
	energy: { currentYear: 45, previousYear: 50, currentMonth: 15, previousMonth: 0 },
	efficiency: { avgEfficiency: 4, bestEfficiency: 4.5, worstEfficiency: 3.5 },
	sessionDetails: { avgEnergy: 15, minEnergy: 12, maxEnergy: 18 },
	averageCost: { perSession: 7, perEnergyUnit: 0.467 },
	priceHistory: [{ date: '2024-01-05', fuelType: 'Level 2 (AC)', pricePerVolume: 0.467 }]
};

describe('FuelStatsTab charging series', () => {
	test('an EV-only fleet sees its charging cards instead of the empty state or zeroed gas cards', () => {
		render(FuelStatsTab, { fuelStats: stats({ charging }), fuelAdvanced: advanced });
		expect(screen.queryByText('No fuel data yet')).toBeNull();
		expect(screen.getByText('Charging Sessions')).toBeTruthy();
		expect(screen.getByText('Energy (kWh)')).toBeTruthy();
		expect(screen.getByText('Average mi/kWh')).toBeTruthy();
		expect(screen.getByText('Worst mi/kWh')).toBeTruthy();
		expect(screen.getByText('Charging Details')).toBeTruthy();
		expect(screen.getByText('18.0 kWh')).toBeTruthy();
		expect(screen.getByText('$0.467')).toBeTruthy();
		expect(screen.getByText('Average Cost')).toBeTruthy();
		expect(screen.getByText('Per Session')).toBeTruthy();
		expect(screen.queryByText('Per Fill-up')).toBeNull();
		expect(screen.queryByText('Fill-ups')).toBeNull();
		expect(screen.queryByText('Fill-up Details')).toBeNull();
	});

	test('an EV-only fleet does not get empty gas-only charts', () => {
		render(FuelStatsTab, { fuelStats: stats({ charging }), fuelAdvanced: advanced });
		expect(screen.getByText('Charging Price')).toBeTruthy();
		expect(screen.queryByText('Gas Price on Fill-up')).toBeNull();
		expect(screen.queryByText('Fill-up Cost by Vehicle')).toBeNull();
		expect(screen.queryByText('Fill-up Patterns by Day of Week')).toBeNull();
		expect(screen.queryByText('Fuel Consumption')).toBeNull();
		expect(screen.getByText('Total Odometer')).toBeTruthy();
	});

	test('a plug-in hybrid fleet sees both the gas and the charging cards', () => {
		render(FuelStatsTab, {
			fuelStats: stats({
				fillups: { currentYear: 4, previousYear: 0, currentMonth: 0, previousMonth: 0 },
				charging
			}),
			fuelAdvanced: advanced
		});
		expect(screen.getByText('Fill-ups')).toBeTruthy();
		expect(screen.getByText('Charging Sessions')).toBeTruthy();
		expect(screen.getByText('Gas Price on Fill-up')).toBeTruthy();
		expect(screen.getByText('Charging Price')).toBeTruthy();
	});

	test('a gas-only fleet shows no charging cards', () => {
		render(FuelStatsTab, {
			fuelStats: stats({
				fillups: { currentYear: 4, previousYear: 0, currentMonth: 0, previousMonth: 0 },
				charging: { ...charging, sessions: zero, energy: zero }
			}),
			fuelAdvanced: advanced
		});
		expect(screen.getByText('Fill-ups')).toBeTruthy();
		expect(screen.queryByText('Charging Sessions')).toBeNull();
	});
});
