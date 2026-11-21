import { beforeEach, describe, expect, test, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/svelte';
import type { Vehicle } from '#lib/types/index.ts';

vi.mock('$app/navigation', () => ({ goto: vi.fn(() => Promise.resolve()) }));
vi.mock('$app/paths', () => ({ resolve: (path: string) => path }));

vi.mock('#lib/components/charts/index.ts', () => ({ AppPieChart: () => {} }));
vi.mock('#lib/components/charts/ExpenseTrendChart.svelte', () => ({ default: () => {} }));
vi.mock('#lib/components/dashboard/VehicleCarousel.svelte', () => ({ default: () => {} }));
vi.mock('#lib/components/dashboard/SharedWithMeCard.svelte', () => ({ default: () => {} }));

const getVehicles = vi.fn();
vi.mock('#lib/services/vehicle-api.ts', () => ({
	vehicleApi: {
		getVehicles: (...args: unknown[]) => getVehicles(...args),
		getAllVehiclePhotos: () => Promise.resolve({}),
		getPhotoThumbnailUrl: () => ''
	}
}));
vi.mock('#lib/services/expense-api.ts', () => ({
	expenseApi: {
		getVehicleStats: () => Promise.resolve([]),
		getExpenseSummary: () =>
			Promise.resolve({
				totalAmount: 0,
				expenseCount: 0,
				recentAmount: 0,
				monthlyAverage: 0,
				categoryBreakdown: [],
				monthlyTrend: []
			}),
		getAllExpenses: () =>
			Promise.resolve({ data: [], pagination: { totalCount: 0, limit: 5, offset: 0 } })
	}
}));
vi.mock('#lib/services/reminder-api.ts', () => ({
	reminderApi: {
		list: () => Promise.resolve([]),
		getRecurringCost: () => Promise.resolve({ count: 0, monthlyTotal: 0 })
	}
}));

import Page from '../+page.svelte';

const OWNED = { id: 'v1', make: 'Toyota', model: 'Camry', year: 2020 } as Vehicle;

function controls(name: string) {
	return [...screen.queryAllByRole('button', { name }), ...screen.queryAllByRole('link', { name })];
}

beforeEach(() => {
	getVehicles.mockReset();
});

describe('dashboard primary action', () => {
	test('with a vehicle, Log Fill-up is the single floating primary and Add Vehicle is secondary', async () => {
		getVehicles.mockImplementation(() => Promise.resolve([OWNED]));
		render(Page);

		await waitFor(() => expect(controls('Log Fill-up')).toHaveLength(1));
		expect(controls('Log Fill-up')[0]).toHaveClass('fixed');
		const addVehicle = controls('Add Vehicle');
		expect(addVehicle).toHaveLength(1);
		expect(addVehicle[0]).not.toHaveClass('fixed');
		expect(addVehicle[0]).not.toHaveClass('bg-primary');
	});

	test('with no vehicles, Add Vehicle is the single floating primary and there is no Log Fill-up', async () => {
		getVehicles.mockImplementation(() => Promise.resolve([]));
		render(Page);

		await waitFor(() => expect(controls('Add Vehicle')).toHaveLength(1));
		expect(controls('Add Vehicle')[0]).toHaveClass('fixed');
		expect(controls('Log Fill-up')).toHaveLength(0);
	});
});
