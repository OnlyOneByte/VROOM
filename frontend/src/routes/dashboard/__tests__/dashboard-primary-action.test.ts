import { beforeEach, describe, expect, test, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/svelte';
import type { Vehicle } from '#lib/types/index.ts';
import { appStore } from '#lib/stores/app.svelte.ts';
import { routes } from '#lib/routes.ts';

vi.mock('$app/navigation', () => ({ goto: vi.fn(() => Promise.resolve()) }));
vi.mock('$app/paths', () => ({ resolve: (path: string) => path }));

vi.mock('#lib/components/charts/index.ts', () => ({ AppPieChart: () => {} }));
vi.mock('#lib/components/charts/ExpenseTrendChart.svelte', () => ({ default: () => {} }));
const carouselProps = vi.hoisted(() => ({ value: null as Record<string, unknown> | null }));
vi.mock('#lib/components/dashboard/VehicleCarousel.svelte', () => ({
	default: (_anchor: unknown, props: Record<string, unknown>) => {
		carouselProps.value = props;
	}
}));
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
	test('with a vehicle, Log Fill-up is the single floating primary and Add Vehicle is secondary', async () => {
		getVehicles.mockImplementation(() => Promise.resolve([OWNED]));
		render(Page);

		await waitFor(() => expect(belowLg('Log Fill-up')).toHaveLength(1));
		expect(belowLg('Log Fill-up')[0]).toHaveClass('fixed');
		expect(belowLg('Add Vehicle')).toHaveLength(0);
		await waitFor(() => expect(carouselProps.value?.['addVehicleHref']).toBe(routes.vehicleNew));
		expect(fromLg('Add Vehicle')).toHaveLength(1);
		expect(fromLg('Add Vehicle')[0]).toHaveClass('border', 'bg-background');
	});

	test('from lg: up, Log Fill-up moves from the floating button to the header', async () => {
		getVehicles.mockImplementation(() => Promise.resolve([OWNED]));
		render(Page);

		await waitFor(() => expect(fromLg('Log Fill-up')).toHaveLength(1));
		const header = screen
			.getByRole('heading', { level: 1, name: 'Dashboard' })
			.closest('.flex-col');
		expect(fromLg('Log Fill-up')[0]).not.toHaveClass('fixed');
		expect(header).toContainElement(fromLg('Log Fill-up')[0] ?? null);
	});

	test('with no vehicles, Add Vehicle is the single floating primary and there is no Log Fill-up', async () => {
		getVehicles.mockImplementation(() => Promise.resolve([]));
		render(Page);

		await waitFor(() => expect(belowLg('Add Vehicle')).toHaveLength(1));
		expect(belowLg('Add Vehicle')[0]).toHaveClass('fixed');
		expect(fromLg('Add Vehicle')).toHaveLength(1);
		expect(fromLg('Add Vehicle')[0]).not.toHaveClass('fixed');
		expect(controls('Log Fill-up')).toHaveLength(0);
	});

	test('with only vehicles shared with me, Add Vehicle is the floating primary and there is no Log Fill-up', async () => {
		getVehicles.mockImplementation(() =>
			Promise.resolve([{ ...OWNED, sharedAccess: { sharedBy: 'Sam' } } as unknown as Vehicle])
		);
		render(Page);

		await waitFor(() => expect(belowLg('Add Vehicle')).toHaveLength(1));
		expect(belowLg('Add Vehicle')[0]).toHaveClass('fixed');
		expect(fromLg('Add Vehicle')).toHaveLength(1);
		expect(fromLg('Add Vehicle')[0]).not.toHaveClass('fixed');
		expect(controls('Log Fill-up')).toHaveLength(0);
	});

	test('no floating action while the first load is in flight', async () => {
		getVehicles.mockImplementation(() => new Promise<Vehicle[]>(() => {}));
		render(Page);
		await new Promise(resolve => setTimeout(resolve, 0));

		expect(controls('Add Vehicle')).toHaveLength(0);
		expect(controls('Log Fill-up')).toHaveLength(0);
	});

	test('from lg the header holds a 40px placeholder for Add Vehicle until the first load settles', async () => {
		let settle: (vehicles: Vehicle[]) => void = () => {};
		getVehicles.mockImplementation(() => new Promise<Vehicle[]>(r => (settle = r)));
		render(Page);
		await new Promise(resolve => setTimeout(resolve, 0));

		const header = screen
			.getByRole('heading', { level: 1, name: 'Dashboard' })
			.closest('.flex-col');
		const placeholder = header?.querySelector('[data-slot="skeleton"]');
		expect(placeholder).toHaveClass('h-10');

		expect(placeholder).toHaveClass('hidden', 'lg:block');

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

		await waitFor(() => expect(belowLg('Add Vehicle')).toHaveLength(1));
		expect(belowLg('Add Vehicle')[0]).toHaveClass('fixed');
		expect(headerPlaceholder()).toBeNull();
	});

	test('a failed load leaves no header placeholder beside the Retry', async () => {
		getVehicles.mockImplementation(() => Promise.reject(new Error('Server down')));
		render(Page);

		await screen.findByRole('button', { name: 'Retry' });
		expect(headerPlaceholder()).toBeNull();
		expect(controls('Add Vehicle')).toHaveLength(0);
	});

	test('with nothing due or recurring, the page shows one Coming up row and a Spending header for the period', async () => {
		getVehicles.mockImplementation(() => Promise.resolve([OWNED]));
		render(Page);

		expect(await screen.findByRole('heading', { name: 'Coming up' })).toBeInTheDocument();
		expect(screen.queryByText('Recurring Costs')).toBeNull();
		const spending = screen.getByRole('heading', { level: 2, name: 'Spending' });
		expect(spending.parentElement).toContainElement(
			screen.getByRole('combobox', { name: 'Select time period' })
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

	test('a failed load offers only a 40px Retry, with no floating action', async () => {
		getVehicles.mockImplementation(() => Promise.reject(new Error('Server down')));
		render(Page);

		const retry = await screen.findByRole('button', { name: 'Retry' });
		expect(retry).toHaveClass('h-10');
		expect(controls('Add Vehicle')).toHaveLength(0);
		expect(controls('Log Fill-up')).toHaveLength(0);
	});
});
