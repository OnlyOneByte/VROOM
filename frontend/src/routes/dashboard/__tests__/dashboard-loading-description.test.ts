import { beforeEach, describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';

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

beforeEach(() => {
	getVehicles.mockReset();
});

describe('dashboard description while loading', () => {
	test('stays neutral until the load finishes, then welcomes a user with no vehicles', async () => {
		let finish: (vehicles: unknown[]) => void = () => {};
		getVehicles.mockReturnValue(new Promise(resolve => (finish = resolve)));
		render(Page);

		expect(screen.getByText('Overview of your vehicles')).toBeInTheDocument();
		expect(screen.queryByText(/Welcome!/)).toBeNull();

		finish([]);
		expect(
			await screen.findByText('Welcome! Get started by adding your first vehicle')
		).toBeInTheDocument();
	});
});
