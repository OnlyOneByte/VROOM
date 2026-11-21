import { describe, expect, test, vi } from 'vitest';
import { render, waitFor } from '@testing-library/svelte';
import type { Vehicle } from '#lib/types/index.ts';

vi.mock('$app/navigation', () => ({ goto: vi.fn(() => Promise.resolve()) }));
vi.mock('$app/paths', () => ({ resolve: (path: string) => path }));

const requested = vi.hoisted(() => new Set<string>());
const tracked = (name: string) => {
	requested.add(name);
	return { default: () => {} };
};
vi.mock('#lib/components/vehicles/FinanceTab.svelte', () => tracked('finance'));
vi.mock('#lib/components/vehicles/OdometerTab.svelte', () => tracked('odometer'));
let uploadDialogProps: Record<string, unknown> | null = null;
vi.mock('#lib/components/common/MediaCaptureDialog.svelte', () => {
	requested.add('upload');
	return {
		default: (_anchor: unknown, props: Record<string, unknown>) => {
			uploadDialogProps = props;
		}
	};
});
vi.mock('#lib/components/expenses/ExpensesTable.svelte', () => {
	requested.add('expenses');
	return { default: () => {} };
});
vi.mock('#lib/components/charts/index.ts', () => ({ AppPieChart: () => {} }));
vi.mock('#lib/components/charts/ExpenseTrendChart.svelte', () => ({ default: () => {} }));
vi.mock('#lib/components/charts/FuelEfficiencyTrendChart.svelte', () => ({ default: () => {} }));
let carouselProps: Record<string, unknown> | null = null;
vi.mock('#lib/components/vehicles/VehiclePhotoCarousel.svelte', () => ({
	default: (_anchor: unknown, props: Record<string, unknown>) => {
		carouselProps = props;
	}
}));
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

const getVehicle = vi.fn(() => Promise.resolve(VEHICLE));
vi.mock('#lib/services/vehicle-api.ts', () => ({
	vehicleApi: {
		getVehicle: () => getVehicle(),
		getVehicleStats: () => Promise.resolve(null),
		getPhotos: () => Promise.resolve({ data: [] }),
		getPhotoThumbnailUrl: () => ''
	}
}));

vi.mock('#lib/services/analytics-api.ts', () => ({
	analyticsApi: { getFuelEfficiency: () => Promise.resolve({ fuelEfficiencyTrend: [] }) }
}));

import Page from '../+page.svelte';

describe('vehicle page — Upload Photos', () => {
	test('the dialog code is ready before the first tap, and that tap opens the dialog', async () => {
		render(Page, { props: { data: { vehicleId: 'v1' } } });

		await waitFor(() => expect(requested.has('upload')).toBe(true));
		await waitFor(() => expect(carouselProps).not.toBeNull());
		expect(uploadDialogProps).toBeNull();

		(carouselProps?.['onUpload'] as () => void)();

		await waitFor(() => expect(uploadDialogProps).not.toBeNull());
		expect(uploadDialogProps?.['open']).toBe(true);
		expect(uploadDialogProps?.['title']).toBe('Upload Vehicle Photos');
	});
});
