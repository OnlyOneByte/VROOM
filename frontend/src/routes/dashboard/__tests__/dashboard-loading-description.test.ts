import { beforeEach, describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';

vi.mock('$app/navigation', () => ({ goto: vi.fn(() => Promise.resolve()) }));
vi.mock('$app/paths', () => ({ resolve: (path: string) => path }));

vi.mock('#lib/components/charts/index.ts', () => ({ AppBarChart: () => {} }));
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

vi.mock('#lib/services/insurance-api.ts', () => ({
	insuranceApi: { getAllPolicies: () => Promise.resolve([]) }
}));
vi.mock('#lib/services/analytics-api.ts', () => ({
	analyticsApi: { query: () => Promise.resolve(null) }
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
		expect(screen.queryByText(/Welcome/)).toBeNull();

		finish([]);
		expect(await screen.findByText('Welcome to VROOM')).toBeInTheDocument();
	});

	test.each([
		[1, '1 vehicle'],
		[2, '2 vehicles']
	])('counts %i vehicle(s) once loaded', async (count, description) => {
		getVehicles.mockResolvedValue(
			Array.from({ length: count }, (_, i) => ({
				id: `v${i}`,
				make: 'Toyota',
				model: 'Camry',
				year: 2020
			}))
		);
		render(Page);

		expect(await screen.findByText(description)).toBeInTheDocument();
	});

	test('names how many of the vehicles are shared', async () => {
		getVehicles.mockResolvedValue([
			{ id: 'v1', make: 'Toyota', model: 'Camry', year: 2020 },
			{ id: 'v2', make: 'Honda', model: 'Civic', year: 2019, sharedAccess: { sharedBy: 'Sam' } }
		]);
		render(Page);

		expect(await screen.findByText('2 vehicles, incl. 1 shared')).toBeInTheDocument();
	});

	test('stays neutral after a load failure', async () => {
		getVehicles.mockRejectedValue(new Error('offline'));
		render(Page);

		expect(await screen.findByText("Couldn't load the dashboard")).toBeInTheDocument();
		expect(screen.getByText('Overview of your vehicles')).toBeInTheDocument();
		expect(screen.queryByText(/Welcome/)).toBeNull();
	});
});
