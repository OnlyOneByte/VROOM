import { describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import type { Vehicle } from '#lib/types/index.ts';

vi.mock('$app/navigation', () => ({ goto: vi.fn(() => Promise.resolve()) }));
vi.mock('$app/paths', () => ({ resolve: (path: string) => path }));

vi.mock('#lib/components/vehicles/FinanceTab.svelte', () => ({ default: () => {} }));
vi.mock('#lib/components/vehicles/OdometerTab.svelte', () => ({ default: () => {} }));
vi.mock('#lib/components/common/MediaCaptureDialog.svelte', () => ({ default: () => {} }));
vi.mock('#lib/components/expenses/ExpensesTable.svelte', () => ({ default: () => {} }));
vi.mock('#lib/components/charts/index.ts', () => ({ AppBarChart: () => {} }));
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

function headerAddExpense(): HTMLElement[] {
	return screen
		.queryAllByRole('link', { name: 'Add expense' })
		.filter(link => link.classList.contains('max-sm:w-10'));
}

function pageAddExpenseActions(): number {
	return headerAddExpense().length;
}

describe('vehicle page Add Expense action per tab', () => {
	test('the header action shows on every tab but Odometer', async () => {
		render(Page, { props: { data: { vehicleId: 'v1' } } });
		await screen.findByRole('tab', { name: 'Odometer' });

		expect(pageAddExpenseActions()).toBe(1);
		expect(headerAddExpense()[0]).not.toHaveClass('fixed', 'hidden');

		for (const tab of ['Expenses', 'Finance']) {
			await fireEvent.click(screen.getByRole('tab', { name: tab }));
			await waitFor(() => expect(pageAddExpenseActions()).toBe(1));
		}

		await fireEvent.click(screen.getByRole('tab', { name: 'Odometer' }));
		await waitFor(() => expect(pageAddExpenseActions()).toBe(0));

		await fireEvent.click(screen.getByRole('tab', { name: 'Overview' }));
		await waitFor(() => expect(pageAddExpenseActions()).toBe(1));
	});
});
