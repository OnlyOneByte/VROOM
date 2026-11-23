import { describe, expect, test, vi } from 'vitest';
import { render } from '@testing-library/svelte';
import type { FuelStatsResponse } from '#lib/types/index.ts';

const { charts } = vi.hoisted(() => ({
	charts: [] as { title: string; xAxisProps?: { ticks?: unknown } }[]
}));

vi.mock('#lib/components/charts/index.ts', () => {
	const stub = (_anchor: unknown, props: { title: string; xAxisProps?: { ticks?: unknown } }) => {
		charts.push({ title: props.title, xAxisProps: props.xAxisProps });
	};
	return { AppLineChart: stub, AppAreaChart: stub, AppBarChart: stub };
});

import FuelCharts from '../FuelCharts.svelte';

const months = Array.from({ length: 13 }, (_, i) => {
	const d = new Date(2024, 10 + i, 1);
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
});

const zero = { currentYear: 0, previousYear: 0, currentMonth: 0, previousMonth: 0 };

const fuelStats: FuelStatsResponse = {
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
	monthlyConsumption: months.map(month => ({ month, efficiency: 30, volume: 40 })),
	gasPriceHistory: [],
	fillupCostByVehicle: months.map(month => ({
		month,
		vehicleId: 'civic',
		vehicleName: 'Civic',
		avgCost: 45
	})),
	odometerProgression: months.map((month, i) => ({
		month,
		vehicleId: 'civic',
		vehicleName: 'Civic',
		mileage: i
	})),
	costPerDistance: months.map(month => ({
		month,
		vehicleId: 'civic',
		vehicleName: 'Civic',
		costPerDistance: 0.1
	})),
	units: { distanceUnit: 'miles', volumeUnit: 'gallons_us', chargeUnit: 'kwh' }
};

describe('FuelCharts monthly x-axis', () => {
	test('a year of monthly data gets at most 6 x-axis ticks on every monthly chart', () => {
		charts.length = 0;
		render(FuelCharts, { props: { fuelStats, group: 'primary' } });
		render(FuelCharts, { props: { fuelStats, group: 'comparisons' } });
		const monthly = [
			'Fuel Efficiency',
			'Fuel Used',
			'Fill-up Cost by Vehicle',
			'Cost/mi',
			'Total Odometer'
		];
		for (const title of monthly) {
			const chart = charts.find(c => c.title === title);
			expect(chart?.xAxisProps?.ticks, title).toBe(6);
		}
	});
});
