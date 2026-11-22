import { describe, expect, test, vi } from 'vitest';
import { render } from '@testing-library/svelte';
import type { FuelAdvancedResponse } from '#lib/types/index.ts';

type AxisProps = { ticks?: string[]; format?: (v: string) => string };

const { charts } = vi.hoisted(() => ({
	charts: [] as { title: string; xAxisProps?: AxisProps }[]
}));

vi.mock('#lib/components/charts/index.ts', () => ({
	AppBarChart: (_anchor: unknown, props: { title: string; xAxisProps?: AxisProps }) => {
		charts.push({ title: props.title, xAxisProps: props.xAxisProps });
	}
}));

import AdvancedCharts from '../AdvancedCharts.svelte';

const fuelAdvanced: FuelAdvancedResponse = {
	maintenanceTimeline: [],
	seasonalEfficiency: [],
	vehicleRadar: [
		{
			vehicleId: 'a',
			vehicleName: 'Daily Driver',
			fuelEfficiency: 40,
			maintenanceCost: 60,
			reliability: 80,
			annualCost: 20,
			mileage: 100
		}
	],
	dayOfWeekPatterns: [],
	monthlyCostHeatmap: [],
	fillupIntervals: []
};

describe('Vehicle Performance Comparison x-axis', () => {
	test('a narrow card labels the metric groups with short names', () => {
		charts.length = 0;
		render(AdvancedCharts, { props: { fuelAdvanced } });
		const axis = charts.find(c => c.title === 'Vehicle Performance Comparison')?.xAxisProps;
		const labels = axis?.ticks?.map(tick => axis.format?.(tick));
		expect(labels).toEqual(['Fuel', 'Maint.', 'Reliab.', 'Cost', 'Miles']);
	});
});
