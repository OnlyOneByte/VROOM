import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import type {
	Expense,
	PaginatedResponse,
	Vehicle,
	VehicleFinancing,
	VehicleStats
} from '#lib/types/index.ts';
import {
	makeExpense,
	makeLease,
	makeLoan
} from '#lib/components/financing/__tests__/financing-fixtures';

vi.mock('$app/paths', () => ({
	resolve: (path: string, params: Record<string, string> = {}) =>
		path.replace(/\[(\w+)\]/g, (_m, key: string) => params[key] ?? '')
}));

const getExpensesByVehicle =
	vi.fn<
		(
			vehicleId: string,
			params: { limit: number; category: string }
		) => Promise<PaginatedResponse<Expense>>
	>();
const updatePaymentAmount =
	vi.fn<(financingId: string, paymentAmount: number) => Promise<VehicleFinancing>>();

vi.mock('#lib/services/expense-api.ts', () => ({
	expenseApi: {
		getExpensesByVehicle: (vehicleId: string, params: { limit: number; category: string }) =>
			getExpensesByVehicle(vehicleId, params)
	}
}));

vi.mock('#lib/services/vehicle-api.ts', () => ({
	vehicleApi: {
		updatePaymentAmount: (financingId: string, paymentAmount: number) =>
			updatePaymentAmount(financingId, paymentAmount)
	}
}));

import FinanceTab from '../FinanceTab.svelte';

function makeVehicle(financing: VehicleFinancing | undefined, overrides: Partial<Vehicle> = {}) {
	return {
		id: 'v1',
		make: 'Toyota',
		model: 'Camry',
		year: 2022,
		vehicleType: 'gas',
		trackFuel: true,
		trackCharging: false,
		initialMileage: 10_000,
		financing,
		createdAt: '2024-01-01T00:00:00.000Z',
		updatedAt: '2024-01-01T00:00:00.000Z',
		...overrides
	} satisfies Vehicle;
}

function stats(overrides: Partial<VehicleStats> = {}): VehicleStats {
	return {
		period: 'all',
		totalMileage: 0,
		currentMileage: null,
		currentOdometer: null,
		totalFuelConsumed: 0,
		totalChargeConsumed: 0,
		averageMpg: null,
		averageMilesPerKwh: null,
		totalFuelCost: 0,
		totalChargeCost: 0,
		costPerMile: null,
		fuelExpenseCount: 0,
		chargeExpenseCount: 0,
		...overrides
	};
}

function page(data: Expense[]): PaginatedResponse<Expense> {
	return { data, pagination: { totalCount: data.length, limit: 100, offset: 0, hasMore: false } };
}

const LOAN_PAYMENTS = [
	makeExpense({ id: 'p2', date: '2025-03-10T12:00:00.000Z', amount: 400 }),
	makeExpense({ id: 'p1', date: '2025-02-10T12:00:00.000Z', amount: 400 }),
	makeExpense({ id: 'fuel', date: '2025-02-20T12:00:00.000Z', amount: 55, sourceType: undefined })
];

function mount(
	vehicle: Vehicle,
	props: { vehicleStatsData?: VehicleStats | null; isOwner?: boolean } = {}
) {
	return render(FinanceTab, {
		props: {
			vehicle,
			vehicleId: vehicle.id,
			vehicleStatsData: props.vehicleStatsData ?? null,
			isOwner: props.isOwner
		}
	});
}

function progressValue(): string | null {
	return screen
		.getByRole('progressbar', { name: 'Payment progress' })
		.getAttribute('aria-valuenow');
}

beforeEach(() => {
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(new Date(2025, 5, 15, 12, 0, 0));
	getExpensesByVehicle.mockReset();
	updatePaymentAmount.mockReset();
	getExpensesByVehicle.mockResolvedValue(page(LOAN_PAYMENTS));
	updatePaymentAmount.mockImplementation((_id, paymentAmount) =>
		Promise.resolve(makeLoan({ paymentAmount }))
	);
});

afterEach(() => {
	cleanup();
	vi.useRealTimers();
});

describe('FinanceTab without active financing', () => {
	test.each<[string, VehicleFinancing | undefined]>([
		['no financing', undefined],
		['inactive financing', makeLoan({ isActive: false })]
	])('shows the empty state for %s and loads nothing', (_label, financing) => {
		mount(makeVehicle(financing));
		expect(screen.getByText(/No active financing/)).toBeTruthy();
		expect(getExpensesByVehicle).not.toHaveBeenCalled();
	});
});

describe('FinanceTab payment history', () => {
	test('loads financial expenses for the vehicle and lists only financing payments', async () => {
		mount(makeVehicle(makeLoan()));
		expect(await screen.findByText(/2 payments recorded/)).toBeTruthy();
		expect(getExpensesByVehicle).toHaveBeenCalledWith('v1', { limit: 100, category: 'financial' });
		expect(screen.queryByText('$55.00')).toBeNull();
	});

	test('derives the amortized balance and interest of each recorded payment', async () => {
		mount(makeVehicle(makeLoan()));
		await screen.findByText(/2 payments recorded/);
		const timeline = screen.getByRole('list', { name: 'Payment history timeline' });
		const [latest, first] = within(timeline).getAllByRole('listitem');
		expect(within(first!).getByText('$100.00')).toBeTruthy();
		expect(within(first!).getByText('$19,700.00')).toBeTruthy();
		expect(within(latest!).getByText('$98.50')).toBeTruthy();
		expect(within(latest!).getByText('$19,398.50')).toBeTruthy();
	});

	test('totals principal and interest paid across the loaded payments', async () => {
		mount(makeVehicle(makeLoan()));
		await screen.findByText(/2 payments recorded/);
		expect(screen.getByText('$601.50')).toBeTruthy();
		expect(screen.getByText('+ $198.50 interest')).toBeTruthy();
		expect(screen.getByText('of 60 scheduled')).toBeTruthy();
		expect(screen.getByText('58 months remaining')).toBeTruthy();
	});

	test('shows a loading placeholder until the payments arrive', async () => {
		let resolveLoad: (value: PaginatedResponse<Expense>) => void = () => {};
		getExpensesByVehicle.mockReturnValue(new Promise(resolve => (resolveLoad = resolve)));
		mount(makeVehicle(makeLoan()));
		expect(screen.queryByText(/payments recorded/)).toBeNull();
		expect(screen.queryByText('No Payment History')).toBeNull();
		resolveLoad(page([]));
		expect(await screen.findByText('No Payment History')).toBeTruthy();
	});

	test('reports a load failure and retries on request', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		getExpensesByVehicle.mockRejectedValueOnce(new Error('offline'));
		mount(makeVehicle(makeLoan()));
		expect(await screen.findByText('Error Loading Payment History')).toBeTruthy();
		expect(screen.getByText(/Failed to load payment history/)).toBeTruthy();
		await fireEvent.click(screen.getByRole('button', { name: 'Try Again' }));
		expect(await screen.findByText(/2 payments recorded/)).toBeTruthy();
		expect(getExpensesByVehicle).toHaveBeenCalledTimes(2);
	});
});

describe('FinanceTab loan summary', () => {
	test('shows the next payment with progress from the computed balance', async () => {
		mount(makeVehicle(makeLoan()));
		await screen.findByText(/2 payments recorded/);
		expect(screen.getByRole('region', { name: 'Next Payment' })).toBeTruthy();
		expect(screen.getByText('Jul 10, 2025')).toBeTruthy();
		expect(screen.getByText('25%')).toBeTruthy();
		expect(progressValue()).toBe('25');
	});

	test('links Record Payment to a prefilled financial expense for this loan', async () => {
		mount(makeVehicle(makeLoan()));
		await screen.findByText(/2 payments recorded/);
		const href = screen.getByRole('link', { name: /Record Payment/ }).getAttribute('href') ?? '';
		const [path, query] = href.split('?');
		expect(path).toBe('/expenses/new');
		const params = new URLSearchParams(query);
		expect(Object.fromEntries(params)).toEqual({
			vehicleId: 'v1',
			category: 'financial',
			financingId: 'fin-1',
			amount: '400',
			returnTo: '/vehicles/v1'
		});
	});

	test('a viewer cannot record or change payments', async () => {
		mount(makeVehicle(makeLoan()), { isOwner: false });
		await screen.findByText(/2 payments recorded/);
		expect(screen.queryByRole('link', { name: /Record Payment/ })).toBeNull();
		expect(screen.queryByRole('button', { name: /Change Payment/ })).toBeNull();
	});

	test('a balance grown above the original amount shows zero progress', async () => {
		mount(makeVehicle(makeLoan({ computedBalance: 20_400 })));
		await screen.findByText(/2 payments recorded/);
		expect(progressValue()).toBe('0');
	});

	test('a missing computed balance counts as nothing paid yet', async () => {
		mount(makeVehicle(makeLoan({ computedBalance: undefined })));
		await screen.findByText(/2 payments recorded/);
		expect(progressValue()).toBe('0');
	});

	test('a paid-off loan shows full progress', async () => {
		mount(makeVehicle(makeLoan({ computedBalance: 0 })));
		await screen.findByText(/2 payments recorded/);
		expect(progressValue()).toBe('100');
	});

	test('changing the payment in the planner saves it for the loan', async () => {
		mount(makeVehicle(makeLoan()));
		await screen.findByText(/2 payments recorded/);
		await fireEvent.click(screen.getByRole('button', { name: /Change Payment/ }));
		const dialog = await screen.findByRole('dialog');
		await fireEvent.input(within(dialog).getByLabelText(/Monthly Payment/), {
			target: { value: '450' }
		});
		await fireEvent.click(within(dialog).getByRole('button', { name: /Save/ }));
		await waitFor(() => expect(updatePaymentAmount).toHaveBeenCalledWith('fin-1', 450));
		await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
	});

	test('a zero-APR loan warns that interest features are unavailable', async () => {
		mount(makeVehicle(makeLoan({ apr: 0 })));
		await screen.findByText(/2 payments recorded/);
		expect(screen.getByText('APR Not Set')).toBeTruthy();
		expect(screen.queryByText('Principal vs Interest')).toBeNull();
		expect(screen.queryByText('Total Cost of Loan')).toBeNull();
		expect(screen.queryByText('Amortization Schedule')).toBeNull();
	});

	test('an interest-bearing loan shows no APR warning', async () => {
		mount(makeVehicle(makeLoan()));
		await screen.findByText(/2 payments recorded/);
		expect(screen.queryByText('APR Not Set')).toBeNull();
	});

	test('invalid financing amounts show an error instead of the summary', async () => {
		mount(makeVehicle(makeLoan({ originalAmount: 0 })));
		expect(screen.getByText('Invalid Financing Data')).toBeTruthy();
		expect(screen.queryByRole('region', { name: 'Next Payment' })).toBeNull();
		expect(screen.queryByText('Payments Made')).toBeNull();
		await screen.findByText(/2 payments recorded/);
	});

	test('a missing payment amount hides the next payment and metrics', async () => {
		mount(makeVehicle(makeLoan({ paymentAmount: 0 })));
		await screen.findByText(/2 payments recorded/);
		expect(screen.queryByRole('region', { name: 'Next Payment' })).toBeNull();
		expect(screen.queryByText('Payments Made')).toBeNull();
	});
});

describe('FinanceTab lease', () => {
	test('shows mileage against the allowance from the latest odometer reading', async () => {
		getExpensesByVehicle.mockResolvedValue(page([]));
		mount(makeVehicle(makeLease()), {
			vehicleStatsData: stats({ currentOdometer: 25_000, currentMileage: 24_000 })
		});
		await screen.findByText('No Payment History');
		const mileage = screen.getByRole('region', { name: 'Mileage' });
		expect(within(mileage).getByText(/15,000/)).toBeTruthy();
		expect(within(mileage).getByText(/21,000 left/)).toBeTruthy();
		expect(screen.getByText('Lease End Date')).toBeTruthy();
		expect(screen.queryByText('APR Not Set')).toBeNull();
		expect(screen.queryByRole('button', { name: /Change Payment/ })).toBeNull();
	});

	test('prices miles beyond the lease allowance as overage', async () => {
		getExpensesByVehicle.mockResolvedValue(page([]));
		mount(makeVehicle(makeLease()), { vehicleStatsData: stats({ currentOdometer: 50_000 }) });
		await screen.findByText('No Payment History');
		expect(screen.getByText('Mileage Overage')).toBeTruthy();
		expect(screen.getByText('$1,000.00')).toBeTruthy();
		expect(screen.getByText(/4,000 mi over/)).toBeTruthy();
	});

	test('falls back to the initial mileage when no odometer reading exists', async () => {
		getExpensesByVehicle.mockResolvedValue(page([]));
		mount(makeVehicle(makeLease()), { vehicleStatsData: null });
		await screen.findByText('No Payment History');
		const mileage = screen.getByRole('region', { name: 'Mileage' });
		expect(within(mileage).getByText(/36,000 left/)).toBeTruthy();
		expect(screen.getByText(/Within limit/)).toBeTruthy();
	});
});
