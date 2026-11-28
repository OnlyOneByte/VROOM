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
	localNoon,
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
	makeExpense({ id: 'p2', date: localNoon(2025, 2, 10), amount: 400 }),
	makeExpense({ id: 'p1', date: localNoon(2025, 1, 10), amount: 400 }),
	makeExpense({
		id: 'fuel',
		date: localNoon(2025, 1, 20),
		amount: 55,
		sourceType: undefined,
		sourceId: undefined
	})
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

function leftToPay(): string {
	return within(screen.getByTestId('loan-hero')).getByRole('list').textContent ?? '';
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

describe('FinanceTab for a shared vehicle', () => {
	test('says the loan is private when the sharee cannot see it', () => {
		mount(
			makeVehicle(undefined, {
				sharedAccess: { level: 'viewer', sharedBy: 'Sam', seesFinancials: false }
			}),
			{ isOwner: false }
		);
		expect(screen.getByText('Loan details are private')).toBeTruthy();
		expect(screen.queryByText(/No active financing/)).toBeNull();
	});

	test('shows no active financing to a sharee who can see loan details', () => {
		mount(
			makeVehicle(undefined, {
				sharedAccess: { level: 'editor', sharedBy: 'Sam', seesFinancials: true }
			}),
			{ isOwner: false }
		);
		expect(screen.getByText(/No active financing/)).toBeTruthy();
	});
});

describe('FinanceTab payment history', () => {
	test('lists only the payments recorded against this loan', async () => {
		mount(makeVehicle(makeLoan()));
		expect(await screen.findByText(/2 payments recorded/)).toBeTruthy();
		const timeline = screen.getByRole('list', { name: 'Payment history' });
		expect(within(timeline).getAllByRole('listitem')).toHaveLength(2);
		expect(screen.queryByText('$55.00')).toBeNull();
	});

	test('derives the amortized balance and interest of each recorded payment', async () => {
		mount(makeVehicle(makeLoan()));
		await screen.findByText(/2 payments recorded/);
		const timeline = screen.getByRole('list', { name: 'Payment history' });
		const [latest, first] = within(timeline).getAllByRole('listitem');
		expect(within(first!).getByText('$100.00')).toBeTruthy();
		expect(within(first!).getByText('$19,700.00')).toBeTruthy();
		expect(within(latest!).getByText('$98.50')).toBeTruthy();
		expect(within(latest!).getByText('$19,398.50')).toBeTruthy();
	});

	test('totals principal and interest paid across the loaded payments', async () => {
		mount(makeVehicle(makeLoan()));
		await screen.findByText(/2 payments recorded/);
		const hero = screen.getByTestId('loan-hero');
		expect(within(hero).getByTestId('loan-sentence')).toHaveTextContent(/^2 of 60 payments made\./);
		expect(within(hero).getByRole('list')).toHaveTextContent(
			/Principal paid\s*\$602.*Interest paid\s*\$199/
		);
		expect(screen.queryByText('of 60 scheduled')).toBeNull();
	});

	test('shows a loading placeholder until the payments arrive', async () => {
		let resolveLoad: (value: PaginatedResponse<Expense>) => void = () => {};
		getExpensesByVehicle.mockReturnValue(new Promise(resolve => (resolveLoad = resolve)));
		mount(makeVehicle(makeLoan()));
		expect(screen.queryByText(/payments recorded/)).toBeNull();
		expect(
			screen.queryByText('No payments recorded yet. Record a payment to track your progress.')
		).toBeNull();
		resolveLoad(page([]));
		expect(
			await screen.findByText('No payments recorded yet. Record a payment to track your progress.')
		).toBeTruthy();
	});

	test('reports a load failure and retries on request', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		getExpensesByVehicle.mockRejectedValueOnce(new Error('offline'));
		mount(makeVehicle(makeLoan()));
		expect(await screen.findByText("Couldn't load payment history")).toBeTruthy();
		expect(screen.getByText('Offline.')).toBeTruthy();
		await fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
		expect(await screen.findByText(/2 payments recorded/)).toBeTruthy();
		expect(getExpensesByVehicle).toHaveBeenCalledTimes(2);
	});
});

describe('FinanceTab loan summary', () => {
	test('after this month is paid the next payment is due next month', async () => {
		getExpensesByVehicle.mockResolvedValue(
			page([makeExpense({ id: 'jun', date: localNoon(2025, 5, 10), amount: 400 })])
		);
		mount(makeVehicle(makeLoan()));
		await screen.findByText(/1 payment recorded/);
		expect(screen.getByRole('region', { name: 'Next payment' })).toBeTruthy();
		expect(screen.getByText('Jul 10, 2025')).toBeTruthy();
	});

	test('a loan shows its progress once, in the hero, from the computed balance', async () => {
		mount(makeVehicle(makeLoan()));
		await screen.findByText(/2 payments recorded/);
		expect(leftToPay()).toMatch(/Left to pay\s*\$15,000/);
		expect(screen.queryByRole('progressbar', { name: 'Payment progress' })).toBeNull();
		expect(screen.queryByText('Paid so far')).toBeNull();
	});

	test('links Record Payment to a prefilled financial expense for this loan', async () => {
		mount(makeVehicle(makeLoan()));
		await screen.findByText(/2 payments recorded/);
		const href = screen.getByRole('link', { name: /Record payment/ }).getAttribute('href') ?? '';
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
		expect(screen.queryByRole('link', { name: /Record payment/ })).toBeNull();
		expect(screen.queryByRole('button', { name: /Payment planner/ })).toBeNull();
	});

	test('a balance grown above the original amount is what is left to pay', async () => {
		mount(makeVehicle(makeLoan({ computedBalance: 20_400 })));
		await screen.findByText(/2 payments recorded/);
		expect(leftToPay()).toMatch(/Left to pay\s*\$20,400/);
	});

	test('a missing computed balance counts as nothing paid yet', async () => {
		mount(makeVehicle(makeLoan({ computedBalance: undefined })));
		await screen.findByText(/2 payments recorded/);
		expect(leftToPay()).toMatch(/Left to pay\s*\$20,000/);
	});

	test('a paid-off loan says so in the hero', async () => {
		mount(makeVehicle(makeLoan({ computedBalance: 0 })));
		await screen.findByText(/2 payments recorded/);
		expect(screen.getByTestId('loan-sentence')).toHaveTextContent(/is paid off/);
	});

	test('a lease, with no loan hero, shows how much is paid so far', async () => {
		mount(makeVehicle(makeLease()));
		await screen.findByText(/2 payments recorded/);
		const next = screen.getByRole('region', { name: 'Next payment' });
		expect(within(next).getByText('Paid so far')).toBeTruthy();
		expect(progressValue()).not.toBeNull();
	});

	test('changing the payment in the planner saves it for the loan', async () => {
		mount(makeVehicle(makeLoan()));
		await screen.findByText(/2 payments recorded/);
		await fireEvent.click(screen.getByRole('button', { name: /Payment planner/ }));
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
		expect(screen.queryByText('Payment schedule')).toBeNull();
	});

	test('an interest-bearing loan shows no APR warning', async () => {
		mount(makeVehicle(makeLoan()));
		await screen.findByText(/2 payments recorded/);
		expect(screen.queryByText('APR Not Set')).toBeNull();
	});

	test('invalid financing amounts show an error instead of the summary', async () => {
		mount(makeVehicle(makeLoan({ originalAmount: 0 })));
		expect(screen.getByText('Invalid Financing Data')).toBeTruthy();
		expect(screen.queryByRole('region', { name: 'Next payment' })).toBeNull();
		expect(screen.queryByText('Payments Made')).toBeNull();
		await screen.findByText(/2 payments recorded/);
	});

	test('a missing payment amount hides the next payment and metrics', async () => {
		mount(makeVehicle(makeLoan({ paymentAmount: 0 })));
		await screen.findByText(/2 payments recorded/);
		expect(screen.queryByRole('region', { name: 'Next payment' })).toBeNull();
		expect(screen.queryByText('Payments Made')).toBeNull();
	});
});

describe('FinanceTab lease', () => {
	test('shows mileage against the allowance from the latest odometer reading', async () => {
		getExpensesByVehicle.mockResolvedValue(page([]));
		mount(makeVehicle(makeLease()), {
			vehicleStatsData: stats({ currentOdometer: 25_000, currentMileage: 24_000 })
		});
		await screen.findByText('No payments recorded yet. Record a payment to track your progress.');
		const mileage = screen.getByRole('region', { name: 'Mileage' });
		expect(within(mileage).getByText(/15,000/)).toBeTruthy();
		expect(within(mileage).getByText(/21,000 left/)).toBeTruthy();
		expect(screen.getByText('Lease End Date')).toBeTruthy();
		expect(screen.queryByText('APR Not Set')).toBeNull();
		expect(screen.queryByRole('button', { name: /Payment planner/ })).toBeNull();
	});

	test('prices miles beyond the lease allowance as overage', async () => {
		getExpensesByVehicle.mockResolvedValue(page([]));
		mount(makeVehicle(makeLease()), { vehicleStatsData: stats({ currentOdometer: 50_000 }) });
		await screen.findByText('No payments recorded yet. Record a payment to track your progress.');
		expect(screen.getByText('Mileage Overage')).toBeTruthy();
		expect(screen.getByText('$1,000.00')).toBeTruthy();
		expect(screen.getByText(/4,000 mi over/)).toBeTruthy();
	});

	test('falls back to the initial mileage when no odometer reading exists', async () => {
		getExpensesByVehicle.mockResolvedValue(page([]));
		mount(makeVehicle(makeLease()), { vehicleStatsData: null });
		await screen.findByText('No payments recorded yet. Record a payment to track your progress.');
		const mileage = screen.getByRole('region', { name: 'Mileage' });
		expect(within(mileage).getByText(/36,000 left/)).toBeTruthy();
		expect(screen.getByText(/Within limit/)).toBeTruthy();
	});
});

describe('FinanceTab heading outline', () => {
	function outline(container: HTMLElement): string[] {
		return [...container.querySelectorAll('h1, h2, h3, h4, h5, h6')].map(
			h => `${h.tagName.toLowerCase()} ${h.textContent?.trim()}`
		);
	}

	function expectNoSkippedLevel(headings: string[]) {
		let previous = 1;
		for (const heading of headings) {
			const level = Number(heading[1]);
			expect(level, heading).toBeLessThanOrEqual(previous + 1);
			previous = level;
		}
	}

	test.each<[string, VehicleFinancing, Expense[]]>([
		['a loan with payment history', makeLoan(), LOAN_PAYMENTS],
		['a loan without payment history', makeLoan(), []],
		['a lease', makeLease(), []]
	])('opens on an h2 and skips no level for %s', async (_label, financing, payments) => {
		getExpensesByVehicle.mockResolvedValue(page(payments));
		const { container } = mount(makeVehicle(financing));
		await screen.findByText(
			payments.length
				? /payments recorded/
				: 'No payments recorded yet. Record a payment to track your progress.'
		);
		const headings = outline(container);
		expect(headings[0]).toBe('h2 Financing');
		expect(headings.filter(h => h.startsWith('h3')).length).toBeGreaterThan(0);
		expectNoSkippedLevel(headings);
	});
});
