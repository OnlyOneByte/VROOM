import { describe, expect, test, vi } from 'vitest';
import { render } from '@testing-library/svelte';
import type { FuelStatsResponse } from '#lib/types/index.ts';

type Series = { key: string; color: string };

const { charts } = vi.hoisted(() => ({
	charts: [] as { title: string; series?: Series[] }[]
}));

vi.mock('#lib/components/charts/index.ts', () => {
	const stub = (_anchor: unknown, props: { title: string; series?: Series[] }) => {
		charts.push({ title: props.title, series: props.series });
	};
	return { AppLineChart: stub, AppAreaChart: stub, AppBarChart: stub };
});

import FuelCharts from '../FuelCharts.svelte';

const zero = { currentYear: 0, previousYear: 0, currentMonth: 0, previousMonth: 0 };
const civic = { vehicleId: 'v-civic', vehicleName: 'Civic' };
const niro = { vehicleId: 'v-niro', vehicleName: 'Niro' };

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
	monthlyConsumption: [],
	gasPriceHistory: [],
	fillupCostByVehicle: [],
	odometerProgression: [
		{ month: '2026-06', ...niro, mileage: 1500 },
		{ month: '2026-06', ...civic, mileage: 20000 }
	],
	costPerDistance: [
		{ month: '2026-06', ...civic, costPerDistance: 0.14 },
		{ month: '2026-06', ...niro, costPerDistance: 0.05 }
	],
	units: { distanceUnit: 'miles', volumeUnit: 'gallons_us', chargeUnit: 'kwh' }
};

describe('FuelCharts vehicle colours', () => {
	test('a vehicle keeps its page colour whatever order a chart lists it in', () => {
		charts.length = 0;
		const vehicleColors = { 'v-civic': 'var(--chart-1)', 'v-niro': 'var(--chart-2)' };
		render(FuelCharts, { props: { fuelStats, group: 'comparisons', vehicleColors } });

		const colours = (title: string) =>
			Object.fromEntries(
				(charts.find(c => c.title === title)?.series ?? []).map(s => [s.key, s.color])
			);

		expect(colours('Total Odometer')).toEqual({ Civic: 'var(--chart-1)', Niro: 'var(--chart-2)' });
		expect(colours('Cost/mi')).toEqual({ Civic: 'var(--chart-1)', Niro: 'var(--chart-2)' });
	});
});
