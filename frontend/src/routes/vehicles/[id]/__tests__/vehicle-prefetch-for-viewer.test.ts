import { describe, expect, test, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/svelte';
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
vi.mock('#lib/components/common/MediaCaptureDialog.svelte', () => tracked('upload'));
vi.mock('#lib/components/expenses/ExpensesTable.svelte', () => {
	requested.add('expenses');
	return { default: () => {} };
});
vi.mock('#lib/components/charts/index.ts', () => ({ AppBarChart: () => {} }));
vi.mock('#lib/components/charts/ExpenseTrendChart.svelte', () => ({ default: () => {} }));
vi.mock('#lib/components/charts/FuelEfficiencyTrendChart.svelte', () => ({ default: () => {} }));
vi.mock('#lib/components/vehicles/VehiclePhotoCarousel.svelte', () => ({ default: () => {} }));
vi.mock('#lib/components/vehicles/FuelEfficiencyStatsCard.svelte', () => ({ default: () => {} }));
vi.mock('#lib/components/insurance/InsuranceTab.svelte', () => ({ default: () => {} }));

vi.mock('#lib/services/reminder-api.ts', () => ({
	reminderApi: { list: () => Promise.resolve([]) }
}));
vi.mock('#lib/services/insurance-api.ts', () => ({
	insuranceApi: { getPoliciesForVehicle: () => Promise.resolve([]) }
}));

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

const pause = () => new Promise(resolve => setTimeout(resolve, 200));

describe('vehicle page — a shared viewer', () => {
	test('a shared viewer gets the tab code but never the owner-only upload dialog', async () => {
		getVehicle.mockImplementationOnce(() =>
			Promise.resolve({
				...VEHICLE,
				sharedAccess: { level: 'viewer', sharedBy: 'owner@example.com' }
			} as unknown as Vehicle)
		);
		render(Page, { props: { data: { vehicleId: 'v1' } } });

		await screen.findByRole('tab', { name: 'Finance' });
		await waitFor(() => expect(requested.has('finance')).toBe(true), { timeout: 3000 });
		await pause();
		expect(requested.has('upload')).toBe(false);
	});
});
