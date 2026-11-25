import { beforeEach, describe, expect, test, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/svelte';
import type { Vehicle } from '#lib/types/index.ts';
import { appStore } from '#lib/stores/app.svelte.ts';

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

function belowLg(name: string) {
	return controls(name).filter(control => !control.classList.contains('hidden'));
}

function fromLg(name: string) {
	return controls(name).filter(control => !control.classList.contains('lg:hidden'));
}

beforeEach(() => {
	getVehicles.mockReset();
});

describe('dashboard primary action', () => {
	test('with a vehicle, Log Fill-up is the single primary at every width and Add Vehicle is secondary', async () => {
		getVehicles.mockImplementation(() => Promise.resolve([OWNED]));
		render(Page);

		await waitFor(() => expect(belowLg('Log Fill-up')).toHaveLength(1));
		expect(controls('Log Fill-up')).toHaveLength(1);
		expect(belowLg('Log Fill-up')[0]).not.toHaveClass('fixed');
		expect(belowLg('Add Vehicle')).toHaveLength(0);
		expect(fromLg('Add Vehicle')).toHaveLength(1);
		expect(fromLg('Add Vehicle')[0]).toHaveClass('border', 'bg-background');
	});

	test('Log Fill-up sits in the page header', async () => {
		getVehicles.mockImplementation(() => Promise.resolve([OWNED]));
		render(Page);

		await waitFor(() => expect(fromLg('Log Fill-up')).toHaveLength(1));
		const header = screen
			.getByRole('heading', { level: 1, name: 'Dashboard' })
			.closest('.flex-col');
		expect(fromLg('Log Fill-up')[0]).not.toHaveClass('fixed');
		expect(header).toContainElement(fromLg('Log Fill-up')[0] ?? null);
	});

	test('with no vehicles, the getting-started card holds the only Add Vehicle and nothing floats', async () => {
		getVehicles.mockImplementation(() => Promise.resolve([]));
		render(Page);

		await screen.findByRole('heading', { name: 'Add your first vehicle' });
		expect(controls('Add Vehicle')).toHaveLength(1);
		expect(controls('Add Vehicle')[0]).not.toHaveClass('fixed');
		expect(controls('Add Vehicle')[0]).toHaveAttribute('href', '/vehicles/new');
		expect(controls('Log Fill-up')).toHaveLength(0);
	});

	test('with only vehicles shared with me, Add Vehicle is the primary and there is no Log Fill-up', async () => {
		getVehicles.mockImplementation(() =>
			Promise.resolve([{ ...OWNED, sharedAccess: { sharedBy: 'Sam' } } as unknown as Vehicle])
		);
		render(Page);

		await waitFor(() => expect(controls('Add Vehicle')).toHaveLength(1));
		expect(controls('Add Vehicle')[0]).not.toHaveClass('fixed', 'hidden');
		expect(controls('Log Fill-up')).toHaveLength(0);
	});

	test('no primary action while the first load is in flight', async () => {
		getVehicles.mockImplementation(() => new Promise<Vehicle[]>(() => {}));
		render(Page);
		await new Promise(resolve => setTimeout(resolve, 0));

		expect(controls('Add Vehicle')).toHaveLength(0);
		expect(controls('Log Fill-up')).toHaveLength(0);
	});

	test('the header holds a 40px placeholder at every width until the first load settles', async () => {
		let settle: (vehicles: Vehicle[]) => void = () => {};
		getVehicles.mockImplementation(() => new Promise<Vehicle[]>(r => (settle = r)));
		render(Page);
		await new Promise(resolve => setTimeout(resolve, 0));

		const header = screen
			.getByRole('heading', { level: 1, name: 'Dashboard' })
			.closest('.flex-col');
		const placeholder = header?.querySelector('[data-slot="skeleton"]');
		expect(placeholder).toHaveClass('h-10');

		expect(placeholder).not.toHaveClass('hidden');

		settle([OWNED]);
		await waitFor(() => expect(fromLg('Add Vehicle')).toHaveLength(1));
		expect(header?.querySelector('[data-slot="skeleton"]')).toBeNull();
		expect(fromLg('Add Vehicle')[0]).toHaveClass('h-10');
	});

	function headerPlaceholder() {
		const header = screen
			.getByRole('heading', { level: 1, name: 'Dashboard' })
			.closest('.flex-col');
		return header?.querySelector('[data-slot="skeleton"]') ?? null;
	}

	test('with no owned vehicles the header placeholder is gone once the load settles', async () => {
		getVehicles.mockImplementation(() => Promise.resolve([]));
		render(Page);

		await screen.findByRole('heading', { name: 'Add your first vehicle' });
		expect(headerPlaceholder()).toBeNull();
	});

	test('a failed load leaves no header placeholder beside the Retry', async () => {
		getVehicles.mockImplementation(() => Promise.reject(new Error('Server down')));
		render(Page);

		await screen.findByRole('button', { name: 'Retry' });
		expect(headerPlaceholder()).toBeNull();
		expect(controls('Add Vehicle')).toHaveLength(0);
	});

	test('with nothing due or recurring, there is no Needs attention card and the hero holds the period', async () => {
		getVehicles.mockImplementation(() => Promise.resolve([OWNED]));
		render(Page);

		const hero = await screen.findByTestId('dashboard-hero');
		expect(screen.queryByRole('heading', { name: 'Needs attention' })).toBeNull();
		expect(screen.queryByText('Recurring Costs')).toBeNull();
		await waitFor(() =>
			expect(within(hero).getByRole('combobox', { name: 'Period: 30 days' })).toBeInTheDocument()
		);
	});

	test('a failed load shows its inline card and raises no error toast', async () => {
		appStore.clearNotifications();
		getVehicles.mockImplementation(() => Promise.reject(new Error('Server down')));
		render(Page);

		await screen.findByRole('button', { name: 'Retry' });
		expect(screen.getByText("Couldn't load the dashboard")).toBeInTheDocument();
		expect(appStore.notifications.filter(n => n.type === 'error')).toEqual([]);
	});

	test('a failed load offers only a 40px Retry, with no primary action', async () => {
		getVehicles.mockImplementation(() => Promise.reject(new Error('Server down')));
		render(Page);

		const retry = await screen.findByRole('button', { name: 'Retry' });
		expect(retry).toHaveClass('h-10');
		expect(controls('Add Vehicle')).toHaveLength(0);
		expect(controls('Log Fill-up')).toHaveLength(0);
	});
});
