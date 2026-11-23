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
const reminders = vi.hoisted(() => ({
	list: [] as unknown[],
	recurring: { count: 0, monthlyTotal: 0 }
}));
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
		list: () => Promise.resolve(reminders.list),
		getRecurringCost: () => Promise.resolve(reminders.recurring)
	}
}));

import Page from '../+page.svelte';

const OWNED = { id: 'v1', make: 'Toyota', model: 'Camry', year: 2020 } as Vehicle;

function controls(name: string) {
	return [...screen.queryAllByRole('button', { name }), ...screen.queryAllByRole('link', { name })];
}

function steps(): string[] {
	const list = screen.getByRole('list', { name: 'Getting started' });
	return [...list.querySelectorAll('li')].map(li =>
		(li.textContent ?? '').replace(/\s+/g, ' ').trim()
	);
}

beforeEach(() => {
	getVehicles.mockReset();
	summary.expenseCount = 0;
	reminders.list = [];
	reminders.recurring = { count: 0, monthlyTotal: 0 };
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
		expect(
			screen.getByRole('list', { name: 'Getting started' }).querySelector('[aria-current="step"]')
				?.textContent
		).toContain('Add a vehicle');
		expect(screen.queryByRole('link', { name: 'Add a vehicle' })).toBeNull();
		expect(controls('Add Vehicle')).toHaveLength(1);
		expect(screen.queryByText('Total Vehicles')).toBeNull();
		expect(screen.queryByRole('heading', { name: 'Spending' })).toBeNull();
	});

	test('with a vehicle but no expenses, step 1 is ticked and Log Fill-up stays the only action', async () => {
		getVehicles.mockResolvedValue([OWNED]);
		render(Page);

		await screen.findByRole('heading', { name: 'Log your first expense' });
		expect(steps()[0]).toBe('Add a vehicle (done)');
		expect(screen.getByRole('link', { name: 'See what it costs' })).toHaveAttribute(
			'href',
			'/analytics'
		);
		expect(controls('Add Expense')).toHaveLength(0);
		expect(controls('Log Fill-up').length).toBeGreaterThan(0);
		expect(screen.queryByText('Total Expenses')).toBeNull();
		expect(screen.queryByRole('heading', { name: 'Spending' })).toBeNull();
	});

	test('with a vehicle but no expenses, due reminders and recurring costs still show', async () => {
		getVehicles.mockResolvedValue([OWNED]);
		reminders.list = [
			{
				reminder: {
					id: 'r1',
					name: 'Oil change',
					isActive: true,
					nextDueDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
					expenseAmount: 60
				},
				vehicleIds: ['v1']
			}
		];
		reminders.recurring = { count: 1, monthlyTotal: 25 };
		render(Page);

		await screen.findByRole('heading', { name: 'Log your first expense' });
		expect(await screen.findByText('Oil change')).toBeInTheDocument();
		expect(screen.getByText('Recurring Costs')).toBeInTheDocument();
	});

	test('with a vehicle but no expenses, recurring costs alone get a full-width row', async () => {
		getVehicles.mockResolvedValue([OWNED]);
		reminders.recurring = { count: 2, monthlyTotal: 40 };
		const { container } = render(Page);

		const title = await screen.findByText('Recurring Costs');
		expect(screen.queryByTestId('coming-up-empty')).toBeNull();
		expect(screen.queryByText('Upcoming Reminders')).toBeNull();
		expect(title.closest('.lg\\:grid-cols-2')).toBeNull();
		expect(container.querySelector('.lg\\:grid-cols-2')).toBeNull();
	});

	test('with a vehicle but no expenses and nothing due, there is no empty Coming Up row', async () => {
		getVehicles.mockResolvedValue([OWNED]);
		render(Page);

		await screen.findByRole('heading', { name: 'Log your first expense' });
		expect(screen.queryByTestId('coming-up-empty')).toBeNull();
		expect(screen.queryByText('Recurring Costs')).toBeNull();
	});

	test('vehicles shared with me never show the checklist', async () => {
		getVehicles.mockResolvedValue([{ ...OWNED, sharedAccess: { sharedBy: 'Sam' } }]);
		render(Page);

		await screen.findByText('Overview of the vehicles shared with you');
		expect(screen.queryByRole('list', { name: 'Getting started' })).toBeNull();
	});

	test('no checklist while loading or after a failed load', async () => {
		let fail: (error: Error) => void = () => {};
		getVehicles.mockReturnValue(new Promise((_, reject) => (fail = reject)));
		render(Page);
		expect(screen.queryByRole('list', { name: 'Getting started' })).toBeNull();

		fail(new Error('offline'));
		await screen.findByText("Couldn't load the dashboard");
		expect(screen.queryByRole('list', { name: 'Getting started' })).toBeNull();
	});

	test('once an expense exists the checklist is gone', async () => {
		getVehicles.mockResolvedValue([OWNED]);
		summary.expenseCount = 3;
		render(Page);

		await screen.findByRole('heading', { name: 'Spending' });
		expect(screen.queryByRole('list', { name: 'Getting started' })).toBeNull();
	});
});
