import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import type { Vehicle } from '#lib/types/index.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(HERE, '..', '+page.svelte'), 'utf8');

const LAZY_MODULES = [
	'#lib/components/charts/index.ts',
	'#lib/components/charts/ExpenseTrendChart.svelte',
	'#lib/components/charts/FuelEfficiencyTrendChart.svelte',
	'#lib/components/expenses/ExpensesTable.svelte',
	'#lib/components/expenses/ExpenseSearchFilters.svelte',
	'#lib/components/vehicles/FinanceTab.svelte',
	'#lib/components/vehicles/OdometerTab.svelte',
	'#lib/components/vehicles/ShareVehicleDialog.svelte',
	'#lib/components/common/MediaCaptureDialog.svelte'
];

vi.mock('$app/navigation', () => ({ goto: vi.fn(() => Promise.resolve()) }));
vi.mock('$app/paths', () => ({ resolve: (path: string) => path }));

let financeProps: Record<string, unknown> | null = null;
let odometerProps: Record<string, unknown> | null = null;
vi.mock('#lib/components/vehicles/FinanceTab.svelte', () => ({
	default: (_anchor: unknown, props: Record<string, unknown>) => {
		financeProps = props;
	}
}));
vi.mock('#lib/components/vehicles/OdometerTab.svelte', () => ({
	default: (_anchor: unknown, props: Record<string, unknown>) => {
		odometerProps = props;
	}
}));
vi.mock('#lib/components/expenses/ExpensesTable.svelte', () => ({ default: () => {} }));
vi.mock('#lib/components/charts/index.ts', () => ({ AppPieChart: () => {} }));
vi.mock('#lib/components/charts/ExpenseTrendChart.svelte', () => ({ default: () => {} }));
vi.mock('#lib/components/charts/FuelEfficiencyTrendChart.svelte', () => ({ default: () => {} }));
vi.mock('#lib/components/vehicles/VehiclePhotoCarousel.svelte', () => ({ default: () => {} }));
vi.mock('#lib/components/vehicles/FuelEfficiencyStatsCard.svelte', () => ({ default: () => {} }));
vi.mock('#lib/components/insurance/InsuranceTab.svelte', () => ({ default: () => {} }));

vi.mock('#lib/services/expense-api.ts', () => ({
	expenseApi: {
		getExpensesByVehicle: () => Promise.resolve({ data: [], pagination: { totalCount: 0 } }),
		getExpenseSummary: () =>
			Promise.resolve({
				totalAmount: 0,
				expenseCount: 0,
				recentAmount: 0,
				monthlyAverage: 0,
				categoryBreakdown: [],
				monthlyTrend: []
			})
	}
}));

const VEHICLE = {
	id: 'v1',
	userId: 'u1',
	make: 'Toyota',
	model: 'Camry',
	year: 2020,
	vehicleType: 'gas',
	nickname: 'Daily Driver',
	createdAt: '2024-01-01T00:00:00.000Z',
	updatedAt: '2024-01-01T00:00:00.000Z'
} as unknown as Vehicle;

vi.mock('#lib/services/vehicle-api.ts', () => ({
	vehicleApi: {
		getVehicle: () => Promise.resolve(VEHICLE),
		getVehicleStats: () => Promise.resolve(null),
		getPhotos: () => Promise.resolve({ data: [] }),
		getPhotoThumbnailUrl: () => ''
	}
}));

vi.mock('#lib/services/analytics-api.ts', () => ({
	analyticsApi: { getFuelEfficiency: () => Promise.resolve({ fuelEfficiencyTrend: [] }) }
}));

import Page from '../+page.svelte';

describe('vehicle page — tab, chart and dialog code loads on demand', () => {
	test.each(LAZY_MODULES)('%s is not imported statically', module => {
		const staticImport = new RegExp(
			`^\\s*import\\s[^;]*from\\s+'${module.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'`,
			'm'
		);
		expect(SRC).not.toMatch(staticImport);
		expect(SRC).toContain(`import('${module}')`);
	});

	test('the Finance and Odometer tabs render once their chunk arrives', async () => {
		render(Page, { props: { data: { vehicleId: 'v1' } } });

		await fireEvent.click(await screen.findByRole('tab', { name: 'Finance' }));
		await waitFor(() => expect(financeProps).not.toBeNull());
		expect(financeProps?.['vehicleId']).toBe('v1');

		await fireEvent.click(screen.getByRole('tab', { name: 'Odometer' }));
		await waitFor(() => expect(odometerProps).not.toBeNull());
		expect(odometerProps?.['vehicleId']).toBe('v1');
	});
});
