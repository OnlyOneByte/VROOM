import { beforeEach, describe, expect, test, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/svelte';
import type { Vehicle } from '#lib/types/index.ts';

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
				expenseCount: 1,
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

const OWNED = { id: 'v1', make: 'Toyota', model: 'Camry', year: 2020 } as Vehicle;

function controls(name: string) {
	return [...screen.queryAllByRole('button', { name }), ...screen.queryAllByRole('link', { name })];
}

beforeEach(() => {
	getVehicles.mockReset();
});

function heroPlaceholder() {
	return screen.queryByTestId('primary-action-placeholder');
}

describe('dashboard primary action', () => {
	test('with a vehicle, Log fill-up is the single primary, in the hero, at every width', async () => {
		getVehicles.mockImplementation(() => Promise.resolve([OWNED]));
		render(Page);

		await waitFor(() => expect(controls('Log fill-up')).toHaveLength(1));
		const logFillup = controls('Log fill-up')[0]!;
		expect(screen.getByTestId('dashboard-hero')).toContainElement(logFillup);
		expect(logFillup.className).not.toMatch(/\bhidden\b|max-sm:hidden|\bfixed\b/);
		expect(controls('Add vehicle')).toHaveLength(0);
	});

	test('with no vehicles, the getting-started card holds the only Add vehicle', async () => {
		getVehicles.mockImplementation(() => Promise.resolve([]));
		render(Page);

		await screen.findByRole('heading', { name: 'Add your first vehicle' });
		expect(controls('Add vehicle')).toHaveLength(1);
		expect(controls('Add vehicle')[0]).toHaveAttribute('href', '/vehicles/new');
		expect(controls('Log fill-up')).toHaveLength(0);
	});

	test('with only vehicles shared with me, Add vehicle is the primary and there is no Log fill-up', async () => {
		getVehicles.mockImplementation(() =>
			Promise.resolve([{ ...OWNED, sharedAccess: { sharedBy: 'Sam' } } as unknown as Vehicle])
		);
		render(Page);

		await waitFor(() => expect(controls('Add vehicle')).toHaveLength(1));
		expect(screen.getByTestId('dashboard-hero')).toContainElement(controls('Add vehicle')[0]!);
		expect(controls('Log fill-up')).toHaveLength(0);
	});

	test('no primary action while the first load is in flight, but a 40px placeholder holds its place', async () => {
		let settle: (vehicles: Vehicle[]) => void = () => {};
		getVehicles.mockImplementation(() => new Promise<Vehicle[]>(r => (settle = r)));
		render(Page);
		await new Promise(resolve => setTimeout(resolve, 0));

		expect(controls('Add vehicle')).toHaveLength(0);
		expect(controls('Log fill-up')).toHaveLength(0);
		expect(heroPlaceholder()).toHaveClass('h-10');
		expect(heroPlaceholder()).not.toHaveClass('hidden');

		settle([OWNED]);
		await waitFor(() => expect(controls('Log fill-up')).toHaveLength(1));
		expect(heroPlaceholder()).toBeNull();
		expect(controls('Log fill-up')[0]).toHaveClass('h-10');
	});

	test('a failed load leaves no placeholder beside the Retry', async () => {
		getVehicles.mockImplementation(() => Promise.reject(new Error('Server down')));
		render(Page);

		await screen.findByRole('button', { name: 'Retry' });
		expect(heroPlaceholder()).toBeNull();
		expect(controls('Add vehicle')).toHaveLength(0);
	});
});
