import { describe, expect, test, vi } from 'vitest';
import { render } from '@testing-library/svelte';
import type { FuelStatsResponse, VolumeUnit } from '#lib/types/index.ts';

const { charts } = vi.hoisted(() => ({
	charts: [] as { title: string; description?: string; y?: unknown }[]
}));

vi.mock('#lib/components/charts/index.ts', () => {
	const stub = (_anchor: unknown, props: { title: string; description?: string; y?: unknown }) => {
		charts.push({ title: props.title, description: props.description, y: props.y });
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

describe('FuelCharts unit descriptions', () => {
	test.each([
		['gallons_us', 'Price per gallon (US)', 'mi/gal', 'gallons (US)'],
		['gallons_uk', 'Price per gallon (UK)', 'mi/gal', 'gallons (UK)'],
		['liters', 'Price per liter', 'mi/L', 'liters']
	] as const)(
		'%s reads "%s", "Monthly %s" and "Monthly %s used"',
		(volumeUnit: VolumeUnit, price, efficiency, volume) => {
			charts.length = 0;
			const units = { distanceUnit: 'miles', volumeUnit, chargeUnit: 'kwh' } as const;
			render(FuelCharts, { props: { fuelStats: { ...fuelStats, units }, group: 'primary' } });

			expect(charts.find(c => c.title === 'Gas Price on Fill-up')?.description).toBe(
				`${price} by fuel type over time`
			);
			expect(charts.find(c => c.title === 'Fuel Efficiency')?.description).toBe(
				`Monthly ${efficiency}`
			);
			expect(charts.find(c => c.title === 'Fuel Used')?.description).toBe(`Monthly ${volume} used`);
		}
	);

	test('efficiency and volume are two charts, one unit each', () => {
		charts.length = 0;
		render(FuelCharts, { props: { fuelStats, group: 'primary' } });

		expect(charts.find(c => c.title === 'Fuel Efficiency')?.y).toBe('efficiency');
		expect(charts.find(c => c.title === 'Fuel Used')?.y).toBe('volume');
		expect(charts.some(c => c.title === 'Fuel Consumption')).toBe(false);
	});
});
