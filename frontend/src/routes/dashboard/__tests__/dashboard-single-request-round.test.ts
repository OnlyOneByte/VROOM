import { beforeEach, describe, expect, test, vi } from 'vitest';
import { render, waitFor } from '@testing-library/svelte';
import type { Vehicle } from '#lib/types/index.ts';

vi.mock('$app/navigation', () => ({ goto: vi.fn(() => Promise.resolve()) }));
vi.mock('$app/paths', () => ({ resolve: (path: string) => path }));

vi.mock('#lib/components/charts/index.ts', () => ({ AppPieChart: () => {} }));
vi.mock('#lib/components/charts/ExpenseTrendChart.svelte', () => ({ default: () => {} }));
vi.mock('#lib/components/dashboard/VehicleCarousel.svelte', () => ({ default: () => {} }));
vi.mock('#lib/components/dashboard/SharedWithMeCard.svelte', () => ({ default: () => {} }));

const getVehicles = vi.fn();
const getAllVehiclePhotos = vi.fn();
const getVehicleStats = vi.fn();
const getExpenseSummary = vi.fn();
const getAllExpenses = vi.fn();
const listReminders = vi.fn();
const getRecurringCost = vi.fn();

vi.mock('#lib/services/vehicle-api.ts', () => ({
	vehicleApi: {
		getVehicles: (...args: unknown[]) => getVehicles(...args),
		getAllVehiclePhotos: (...args: unknown[]) => getAllVehiclePhotos(...args),
		getPhotoThumbnailUrl: () => ''
	}
}));
vi.mock('#lib/services/expense-api.ts', () => ({
	expenseApi: {
		getVehicleStats: (...args: unknown[]) => getVehicleStats(...args),
		getExpenseSummary: (...args: unknown[]) => getExpenseSummary(...args),
		getAllExpenses: (...args: unknown[]) => getAllExpenses(...args)
	}
}));
vi.mock('#lib/services/reminder-api.ts', () => ({
	reminderApi: {
		list: (...args: unknown[]) => listReminders(...args),
		getRecurringCost: (...args: unknown[]) => getRecurringCost(...args)
	}
}));

import Page from '../+page.svelte';

const VEHICLE: Vehicle = {
	id: 'v1',
	userId: 'u1',
	make: 'Toyota',
	model: 'Camry',
	year: 2020,
	vehicleType: 'car',
	createdAt: '2024-01-01T00:00:00.000Z',
	updatedAt: '2024-01-01T00:00:00.000Z'
} as unknown as Vehicle;

beforeEach(() => {
	vi.clearAllMocks();
	getVehicles.mockImplementation(() => Promise.resolve([VEHICLE]));
	getAllVehiclePhotos.mockImplementation(() => Promise.resolve({}));
	getVehicleStats.mockImplementation(() => Promise.resolve([]));
	getAllExpenses.mockImplementation(() =>
		Promise.resolve({ data: [], pagination: { totalCount: 0, limit: 5, offset: 0 } })
	);
	listReminders.mockImplementation(() => Promise.resolve([]));
	getRecurringCost.mockImplementation(() => Promise.resolve({ count: 0, monthlyTotal: 0 }));
	getExpenseSummary.mockImplementation(() =>
		Promise.resolve({
			totalAmount: 0,
			expenseCount: 0,
			recentAmount: 0,
			monthlyAverage: 0,
			categoryBreakdown: [],
			monthlyTrend: []
		})
	);
});

describe('dashboard initial load', () => {
	test('cover photos and per-vehicle stats do NOT queue behind the vehicle list', async () => {
		getVehicles.mockImplementation(() => new Promise<Vehicle[]>(() => {}));

		render(Page);

		await waitFor(() => {
			expect(getAllVehiclePhotos).toHaveBeenCalled();
			expect(getVehicleStats).toHaveBeenCalled();
		});
	});

	test('all eight opening reads are issued, and each exactly once', async () => {
		render(Page);

		await waitFor(() => expect(getVehicleStats).toHaveBeenCalled());
		for (const [name, spy] of [
			['vehicles', getVehicles],
			['cover photos', getAllVehiclePhotos],
			['per-vehicle stats', getVehicleStats],
			['recent expenses', getAllExpenses],
			['reminders', listReminders],
			['recurring cost', getRecurringCost]
		] as const) {
			expect(spy.mock.calls.length, `${name} requested exactly once`).toBe(1);
		}
		expect(getExpenseSummary.mock.calls.length).toBe(1);
	});
});
