import { beforeEach, describe, expect, test, vi } from 'vitest';
import { render, waitFor } from '@testing-library/svelte';
import type { Vehicle } from '#lib/types/index.ts';

vi.mock('$app/navigation', () => ({ goto: vi.fn(() => Promise.resolve()) }));
vi.mock('$app/paths', () => ({ resolve: (path: string) => path }));

vi.mock('#lib/components/charts/index.ts', () => ({ AppBarChart: () => {} }));
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

const getAllPolicies = vi.fn(() => Promise.resolve([]));
const analyticsQuery = vi.fn(() => Promise.resolve(null));
vi.mock('#lib/services/insurance-api.ts', () => ({
	insuranceApi: { getAllPolicies: () => getAllPolicies() }
}));
vi.mock('#lib/services/analytics-api.ts', () => ({
	analyticsApi: { query: (...args: unknown[]) => analyticsQuery(...(args as [])) }
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
			monthlyTrend: [],
			costBuckets: { ownershipTotal: 0, runningTotal: 0, previous: null, byVehicle: [] }
		})
	);
});

describe('dashboard initial load', () => {
	test('the period numbers, policies and charts do NOT queue behind the vehicle list', async () => {
		getVehicles.mockImplementation(() => new Promise<Vehicle[]>(() => {}));

		render(Page);

		await waitFor(() => {
			expect(getExpenseSummary).toHaveBeenCalledWith({ period: '30d' });
			expect(getAllPolicies).toHaveBeenCalled();
			expect(analyticsQuery).toHaveBeenCalledTimes(2);
		});
	});

	test('every opening read is issued exactly once, with nothing per shared vehicle when none is shared', async () => {
		render(Page);

		await waitFor(() => expect(analyticsQuery).toHaveBeenCalledTimes(2));
		for (const [name, spy] of [
			['vehicles', getVehicles],
			['recent expenses', getAllExpenses],
			['reminders', listReminders],
			['recurring cost', getRecurringCost],
			['policies', getAllPolicies]
		] as const) {
			expect(spy.mock.calls.length, `${name} requested exactly once`).toBe(1);
		}
		expect(getExpenseSummary.mock.calls.map(call => call[0])).toEqual([
			{ period: 'all' },
			{ period: '30d' }
		]);
		expect(getAllVehiclePhotos).not.toHaveBeenCalled();
		expect(getVehicleStats).not.toHaveBeenCalled();
	});

	test('a shared vehicle adds its own summary for the period', async () => {
		getVehicles.mockImplementation(() =>
			Promise.resolve([VEHICLE, { ...VEHICLE, id: 'v2', sharedAccess: { sharedBy: 'Sam' } }])
		);
		render(Page);

		await waitFor(() =>
			expect(getExpenseSummary).toHaveBeenCalledWith({ vehicleId: 'v2', period: '30d' })
		);
	});
});
