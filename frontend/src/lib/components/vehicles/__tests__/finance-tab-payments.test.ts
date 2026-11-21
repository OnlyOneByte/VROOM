import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/svelte';
import type { Expense, Vehicle, VehicleFinancing } from '#lib/types/index.ts';

const getExpensesByVehicle = vi.fn();
vi.mock('#lib/services/expense-api.ts', () => ({ expenseApi: { getExpensesByVehicle } }));
vi.mock('#lib/services/vehicle-api.ts', () => ({ vehicleApi: { updatePaymentAmount: vi.fn() } }));

const FinanceTab = (await import('../FinanceTab.svelte')).default;

const FINANCING: VehicleFinancing = {
	id: 'fin-current',
	vehicleId: 'veh-1',
	financingType: 'loan',
	provider: 'Credit Union',
	originalAmount: 20000,
	computedBalance: 12000,
	apr: 4.5,
	termMonths: 60,
	startDate: new Date(2022, 0, 15, 12).toISOString(),
	paymentAmount: 400,
	paymentFrequency: 'monthly',
	paymentDayOfMonth: 15,
	isActive: true,
	createdAt: '2022-01-15T12:00:00.000Z',
	updatedAt: '2022-01-15T12:00:00.000Z'
};

const VEHICLE: Vehicle = {
	id: 'veh-1',
	make: 'Toyota',
	model: 'Camry',
	year: 2021,
	vehicleType: 'gas',
	trackFuel: true,
	trackCharging: false,
	financing: FINANCING,
	createdAt: '2022-01-15T12:00:00.000Z',
	updatedAt: '2022-01-15T12:00:00.000Z'
};

function payment(id: string, date: Date, sourceId = FINANCING.id): Expense {
	return {
		id,
		vehicleId: 'veh-1',
		userId: 'user-1',
		category: 'financial',
		amount: 400,
		date: date.toISOString(),
		tags: [],
		sourceType: 'financing',
		sourceId,
		createdAt: date.toISOString(),
		updatedAt: date.toISOString()
	};
}

function monthly(prefix: string, from: Date, count: number, sourceId?: string): Expense[] {
	return Array.from({ length: count }, (_, i) =>
		payment(`${prefix}-${i}`, new Date(from.getFullYear(), from.getMonth() + i, 15, 12), sourceId)
	);
}

function page(data: Expense[], hasMore: boolean) {
	return {
		data,
		pagination: { totalCount: 0, limit: 100, offset: 0, hasMore }
	};
}

beforeEach(() => {
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(new Date(2026, 5, 20, 9));
	vi.clearAllMocks();
});
afterEach(() => {
	vi.useRealTimers();
});

describe('FinanceTab payment history', () => {
	test('pages past 100 expenses and keeps only this loan’s payments', async () => {
		const current = monthly('cur', new Date(2022, 1, 1), 53);
		const earlierLoan = monthly('old', new Date(2019, 0, 1), 30, 'fin-earlier');
		const insurance = monthly('ins', new Date(2022, 0, 1), 40).map(e => ({
			...e,
			sourceType: 'insurance_term',
			sourceId: 'term-1'
		}));
		const all = [...current, ...earlierLoan, ...insurance].sort((a, b) =>
			b.date.localeCompare(a.date)
		);
		getExpensesByVehicle
			.mockResolvedValueOnce(page(all.slice(0, 100), true))
			.mockResolvedValueOnce(page(all.slice(100), false));

		render(FinanceTab, { props: { vehicle: VEHICLE, vehicleId: 'veh-1', vehicleStatsData: null } });

		expect(await screen.findByText('53 payments recorded')).toBeTruthy();
		expect(getExpensesByVehicle).toHaveBeenCalledTimes(2);
		expect(getExpensesByVehicle.mock.calls[1]?.[1]).toMatchObject({ offset: 100, limit: 100 });
	});

	test('the next payment is due after the newest payment, and overdue when the last due date is unpaid', async () => {
		getExpensesByVehicle.mockResolvedValueOnce(
			page(monthly('cur', new Date(2022, 1, 1), 52).reverse(), false)
		);

		render(FinanceTab, { props: { vehicle: VEHICLE, vehicleId: 'veh-1', vehicleStatsData: null } });

		await waitFor(() => expect(screen.getByText(/Overdue by 5 days/)).toBeTruthy());
	});

	test('with the last due date paid, the next payment is due next month', async () => {
		getExpensesByVehicle.mockResolvedValueOnce(
			page(monthly('cur', new Date(2022, 1, 1), 53).reverse(), false)
		);

		render(FinanceTab, { props: { vehicle: VEHICLE, vehicleId: 'veh-1', vehicleStatsData: null } });

		await waitFor(() => expect(screen.getByText(/Due in 25 days/)).toBeTruthy());
	});

	test('a payment history that fails to load never shows the loan as overdue', async () => {
		getExpensesByVehicle.mockRejectedValueOnce(new Error('offline'));

		render(FinanceTab, { props: { vehicle: VEHICLE, vehicleId: 'veh-1', vehicleStatsData: null } });

		expect(await screen.findByText("Couldn't load payment history")).toBeTruthy();
		expect(screen.queryByText(/Overdue/)).toBeNull();
		expect(screen.getByText(/Due in 25 days/)).toBeTruthy();
	});
});
