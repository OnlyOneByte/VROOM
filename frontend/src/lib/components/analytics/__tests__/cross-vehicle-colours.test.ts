import { beforeEach, describe, expect, test, vi } from 'vitest';
import { render, waitFor } from '@testing-library/svelte';

type Series = { key: string; label: string; color: string };

const { api, lines } = vi.hoisted(() => ({
	api: {
		getCrossVehicle: vi.fn(),
		getFinancing: vi.fn(),
		getInsurance: vi.fn(),
		query: vi.fn(() => Promise.resolve(null))
	},
	lines: [] as { title: string; series: Series[]; data: Record<string, unknown>[] }[]
}));

vi.mock('#lib/components/charts/index.ts', () => ({
	AppBarChart: () => {},
	AppPieChart: () => {},
	AppLineChart: (
		_anchor: unknown,
		props: { title: string; series: Series[]; data: Record<string, unknown>[] }
	) => {
		lines.push({ title: props.title, series: props.series, data: props.data });
	}
}));
vi.mock('#lib/components/charts/ExpenseTrendChart.svelte', () => ({ default: () => {} }));
vi.mock('../cross-vehicle/FinancingAnalytics.svelte', () => ({ default: () => {} }));
vi.mock('../cross-vehicle/InsuranceAnalytics.svelte', () => ({ default: () => {} }));
vi.mock('#lib/services/analytics-api.ts', () => ({
	analyticsApi: api,
	getDefaultDateRange: () => ({ startDate: 10, endDate: 20, ytdStart: 5 })
}));

import CrossVehicleTab from '../CrossVehicleTab.svelte';
import { buildVehicleColorMap } from '#lib/utils/chart-colors.ts';

beforeEach(() => {
	vi.clearAllMocks();
	lines.length = 0;
	api.getCrossVehicle.mockResolvedValue({
		monthlyExpenseTrends: [],
		expenseByCategory: [],
		vehicleCostComparison: [],
		fuelEfficiencyComparison: [
			{
				month: '2026-05',
				vehicles: [
					{ vehicleId: 'v-civic', vehicleName: 'Civic', efficiency: 36 },
					{ vehicleId: 'v-civic-2', vehicleName: 'Civic', efficiency: 31 }
				]
			}
		],
		units: { distanceUnit: 'miles', volumeUnit: 'gallons_us', chargeUnit: 'kwh' }
	});
	api.getFinancing.mockResolvedValue({});
	api.getInsurance.mockResolvedValue({});
});

describe('Fuel Efficiency Comparison series', () => {
	test('are keyed by vehicle id, so two cars named "Civic" are two series in the page colours', async () => {
		const vehicleColors = buildVehicleColorMap(['v-camry', 'v-civic', 'v-civic-2']);
		render(CrossVehicleTab, { vehicleColors });
		await waitFor(() =>
			expect(lines.some(l => l.title === 'Fuel Efficiency Comparison')).toBe(true)
		);
		const chart = lines.filter(l => l.title === 'Fuel Efficiency Comparison').at(-1)!;
		expect(chart.series).toEqual([
			{ key: 'v-civic', label: 'Civic', color: vehicleColors['v-civic'] },
			{ key: 'v-civic-2', label: 'Civic', color: vehicleColors['v-civic-2'] }
		]);
		expect(chart.data[0]).toMatchObject({ 'v-civic': 36, 'v-civic-2': 31 });
	});
});
