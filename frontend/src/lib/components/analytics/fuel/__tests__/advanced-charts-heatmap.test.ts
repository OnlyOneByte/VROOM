import { describe, expect, test, vi } from 'vitest';
import { render } from '@testing-library/svelte';
import { EXPENSE_CATEGORIES } from '#lib/constants/expense-categories.ts';
import type { FuelAdvancedResponse } from '#lib/types/index.ts';

type ChartProps = {
	title: string;
	y?: string | string[];
	series: { key: string }[];
	seriesLayout?: string;
	yDomain?: [number, number];
};

const { charts } = vi.hoisted(() => ({ charts: [] as ChartProps[] }));

vi.mock('#lib/components/charts/index.ts', () => ({
	AppBarChart: (_anchor: unknown, props: ChartProps) => {
		charts.push({ ...props });
	}
}));

import AdvancedCharts from '../AdvancedCharts.svelte';

const month = { regulatory: 0, enhancement: 0, misc: 0 };

const fuelAdvanced: FuelAdvancedResponse = {
	maintenanceTimeline: [],
	seasonalEfficiency: [],
	vehicleRadar: [],
	dayOfWeekPatterns: [],
	monthlyCostHeatmap: [
		{ month: '2025-12', fuel: 143.41, maintenance: 75, financial: 372.86, ...month },
		{ month: '2026-01', fuel: 100, maintenance: 900, financial: 1000, ...month }
	],
	fillupIntervals: []
};

describe('Monthly Cost Heatmap', () => {
	test('stacks its series without an explicit y, which would zero every bar', () => {
		charts.length = 0;
		render(AdvancedCharts, { props: { fuelAdvanced, group: 'comparisons' } });
		const heatmap = charts.find(c => c.title === 'Monthly Cost Heatmap');
		expect(heatmap?.seriesLayout).toBe('stack');
		expect(heatmap?.y).toBeUndefined();
		expect(heatmap?.series.map(s => s.key)).toEqual([...EXPENSE_CATEGORIES]);
	});

	test('the y domain still reaches the tallest month', () => {
		charts.length = 0;
		render(AdvancedCharts, { props: { fuelAdvanced, group: 'comparisons' } });
		const heatmap = charts.find(c => c.title === 'Monthly Cost Heatmap');
		expect(heatmap?.yDomain?.[0]).toBe(0);
		expect(heatmap?.yDomain?.[1]).toBeCloseTo(2000 * 1.05);
	});
});
