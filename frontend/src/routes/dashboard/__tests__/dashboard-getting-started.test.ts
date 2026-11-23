import { beforeEach, describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import type { Vehicle } from '#lib/types/index.ts';

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
const summary = vi.hoisted(() => ({ expenseCount: 0 }));
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
				totalAmount: summary.expenseCount * 10,
				expenseCount: summary.expenseCount,
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

function steps(): string[] {
	const list = screen.getByRole('list', { name: 'Getting started' });
	return [...list.querySelectorAll('li')].map(li =>
		(li.textContent ?? '').replace(/\s+/g, ' ').trim()
	);
}

beforeEach(() => {
	getVehicles.mockReset();
	summary.expenseCount = 0;
});

describe('dashboard getting started', () => {
	test('with no vehicles it shows only the checklist: no stat tiles or spending', async () => {
		getVehicles.mockResolvedValue([]);
		render(Page);

		await screen.findByRole('heading', { name: 'Add your first vehicle' });
		expect(steps()).toEqual([
			'1 Add a vehicle',
			'2 Log an expense or fill-up',
			'3 See what it costs'
		]);
		expect(screen.getByRole('link', { name: 'Add a vehicle' })).toHaveAttribute(
			'href',
			'/vehicles/new'
		);
		expect(screen.queryByText('Total Vehicles')).toBeNull();
		expect(screen.queryByRole('heading', { name: 'Spending' })).toBeNull();
	});

	test('with a vehicle but no expenses, step 1 is ticked and the card asks for an expense', async () => {
		getVehicles.mockResolvedValue([OWNED]);
		render(Page);

		await screen.findByRole('heading', { name: 'Log your first expense' });
		expect(steps()[0]).toBe('Add a vehicle (done)');
		expect(screen.queryByRole('link', { name: 'Add a vehicle' })).toBeNull();
		expect(screen.getByRole('link', { name: 'Add Expense' })).toHaveAttribute(
			'href',
			'/expenses/new'
		);
	});

	test('once an expense exists the checklist is gone', async () => {
		getVehicles.mockResolvedValue([OWNED]);
		summary.expenseCount = 3;
		render(Page);

		await screen.findByRole('heading', { name: 'Spending' });
		expect(screen.queryByRole('list', { name: 'Getting started' })).toBeNull();
	});
});
