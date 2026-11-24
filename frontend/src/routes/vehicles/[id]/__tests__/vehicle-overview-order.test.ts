import { describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
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
		getExpensesByVehicle: () =>
			Promise.resolve({
				data: [
					{
						id: 'e1',
						vehicleId: 'v1',
						category: 'fuel',
						amount: 40,
						date: '2026-11-20T12:00:00.000Z',
						description: 'Arco'
					}
				],
				pagination: { totalCount: 1 }
			}),
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

vi.mock('#lib/services/reminder-api.ts', () => ({
	reminderApi: {
		list: () =>
			Promise.resolve([
				{
					reminder: {
						id: 'r1',
						name: 'Oil change',
						type: 'notification',
						isActive: true,
						nextDueDate: new Date(Date.now() - 86_400_000).toISOString()
					},
					vehicleIds: ['v1']
				}
			])
	}
}));

vi.mock('#lib/services/insurance-api.ts', () => ({
	insuranceApi: { getPoliciesForVehicle: () => Promise.resolve([]) }
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
	test('the hero comes first, then Next up and Recent expenses, then the details disclosure', async () => {
		render(Page, { props: { data: { vehicleId: 'v1' } } });

		const recent = await screen.findByText('Last 30 days');
		const hero = screen.getByTestId('cost-per-mile-hero');
		const nextUp = await screen.findByRole('heading', { name: 'Next up' });
		const recentExpenses = screen.getByRole('heading', { name: 'Recent expenses' });
		const details = screen.getByRole('button', { name: 'Details, insurance and photos' });

		expect(follows(recent, hero) || hero.contains(recent)).toBe(true);
		expect(follows(nextUp, hero)).toBe(true);
		expect(follows(recentExpenses, nextUp)).toBe(true);
		expect(follows(details, recentExpenses)).toBe(true);
	});

	test('the category chart moved to the Expenses tab and still describes this vehicle', async () => {
		render(Page, { props: { data: { vehicleId: 'v1' } } });

		await screen.findByText('Last 30 days');
		expect(pieProps.value).toBeNull();
		await fireEvent.click(screen.getByRole('tab', { name: 'Expenses' }));
		await vi.waitFor(() => expect(pieProps.value).not.toBeNull());
		expect(pieProps.value?.['description']).toBe('Distribution for this vehicle');
	});
});
