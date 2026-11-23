import { describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import type { Vehicle } from '#lib/types/index.ts';

vi.mock('$app/navigation', () => ({ goto: vi.fn(() => Promise.resolve()) }));
vi.mock('$app/paths', () => ({ resolve: (path: string) => path }));

vi.mock('#lib/components/insurance/InsuranceTab.svelte', () => ({ default: () => {} }));
vi.mock('#lib/components/vehicles/FinanceTab.svelte', () => ({ default: () => {} }));
vi.mock('#lib/components/vehicles/OdometerTab.svelte', () => ({ default: () => {} }));
vi.mock('#lib/components/common/MediaCaptureDialog.svelte', () => ({ default: () => {} }));
vi.mock('#lib/components/expenses/ExpensesTable.svelte', () => ({ default: () => {} }));
vi.mock('#lib/components/charts/ExpenseTrendChart.svelte', () => ({ default: () => {} }));
vi.mock('#lib/components/charts/FuelEfficiencyTrendChart.svelte', () => ({ default: () => {} }));
vi.mock('#lib/components/vehicles/FuelEfficiencyStatsCard.svelte', () => ({ default: () => {} }));

const pieProps = vi.hoisted(() => ({ value: null as Record<string, unknown> | null }));
vi.mock('#lib/components/charts/index.ts', () => ({
	AppPieChart: (_anchor: unknown, props: Record<string, unknown>) => {
		pieProps.value = props;
	}
}));

vi.mock('#lib/services/expense-api.ts', () => ({
	expenseApi: {
		getExpensesByVehicle: () => Promise.resolve({ data: [], pagination: { totalCount: 0 } }),
		getExpenseSummary: () =>
			Promise.resolve({
				totalAmount: 1200,
				expenseCount: 4,
				recentAmount: 300,
				monthlyAverage: 100,
				categoryBreakdown: [{ category: 'fuel', amount: 1200, count: 4 }],
				monthlyTrend: [],
				costBuckets: { ownershipTotal: 0, runningTotal: 1200, previous: null, byVehicle: [] }
			})
	}
}));

vi.mock('#lib/services/analytics-api.ts', () => ({
	analyticsApi: { getFuelEfficiency: () => Promise.resolve({ fuelEfficiencyTrend: [] }) }
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

import Page from '../+page.svelte';

function follows(later: Node, earlier: Node): boolean {
	return (earlier.compareDocumentPosition(later) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
}

describe('vehicle Overview puts the numbers first', () => {
	test('the cost per distance hero comes before the vehicle details and the photos', async () => {
		render(Page, { props: { data: { vehicleId: 'v1' } } });

		const recent = await screen.findByText('Last 30 days');
		const total = screen.getByTestId('cost-per-mile-hero');
		const details = screen.getByRole('heading', { name: 'Vehicle Information' });
		const photos = screen.getByRole('heading', { name: 'Photos' });

		expect(follows(recent, total)).toBe(true);
		expect(follows(details, recent)).toBe(true);
		expect(follows(photos, details)).toBe(true);
	});

	test('the category chart describes this vehicle, not the fleet', async () => {
		render(Page, { props: { data: { vehicleId: 'v1' } } });

		await screen.findByTestId('cost-per-mile-hero');
		await vi.waitFor(() => expect(pieProps.value).not.toBeNull());
		expect(pieProps.value?.['description']).toBe('Distribution for this vehicle');
	});
});
