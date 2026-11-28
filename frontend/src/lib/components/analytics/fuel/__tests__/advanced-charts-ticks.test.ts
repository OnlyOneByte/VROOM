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

import AdvancedCharts, { radarTickLabel } from '../AdvancedCharts.svelte';

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

describe('Vehicle performance comparison x-axis', () => {
	test('a narrow card staggers every other metric name onto a second line', () => {
		charts.length = 0;
		render(AdvancedCharts, { props: { fuelAdvanced, group: 'comparisons' } });
		const axis = charts.find(c => c.title === 'Vehicle performance comparison')?.xAxisProps;
		const labels = axis?.ticks?.map(tick => axis.format?.(tick));
		expect(labels).toEqual([
			'Efficiency',
			'\u00a0\nMaintenance',
			'Reliability',
			'\u00a0\nAnnual cost',
			'Mileage'
		]);
	});

	test('a card 500px or wider keeps every name on one line', () => {
		expect(radarTickLabel('Maintenance cost', 499)).toBe('\u00a0\nMaintenance');
		expect(radarTickLabel('Maintenance cost', 500)).toBe('Maintenance');
		expect(radarTickLabel('Annual cost', 500)).toBe('Annual cost');
	});

	test('an unknown metric keeps its own name', () => {
		expect(radarTickLabel('Something Else', 0)).toBe('Something Else');
	});
});
