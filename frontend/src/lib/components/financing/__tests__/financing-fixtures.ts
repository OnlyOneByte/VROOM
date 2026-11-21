import type { DerivedPaymentEntry, Expense, VehicleFinancing } from '#lib/types/index.ts';

export function makeLoan(overrides: Partial<VehicleFinancing> = {}): VehicleFinancing {
	return {
		id: 'fin-1',
		vehicleId: 'v1',
		financingType: 'loan',
		provider: 'Test Bank',
		originalAmount: 20_000,
		computedBalance: 15_000,
		apr: 6,
		termMonths: 60,
		startDate: '2025-01-10T12:00:00',
		paymentAmount: 400,
		paymentFrequency: 'monthly',
		isActive: true,
		createdAt: '2025-01-10T00:00:00.000Z',
		updatedAt: '2025-01-10T00:00:00.000Z',
		...overrides
	};
}

export function makeLease(overrides: Partial<VehicleFinancing> = {}): VehicleFinancing {
	return makeLoan({
		financingType: 'lease',
		provider: 'Test Leasing',
		apr: undefined,
		originalAmount: 14_400,
		computedBalance: 9_600,
		termMonths: 36,
		startDate: '2024-06-15T12:00:00',
		paymentAmount: 400,
		mileageLimit: 12_000,
		excessMileageFee: 0.25,
		...overrides
	});
}

export function makeExpense(overrides: Partial<Expense> = {}): Expense {
	return {
		id: 'e1',
		vehicleId: 'v1',
		userId: 'u1',
		tags: [],
		category: 'financial',
		date: '2025-02-10T12:00:00.000Z',
		amount: 400,
		sourceType: 'financing',
		createdAt: '2025-02-10T12:00:00.000Z',
		updatedAt: '2025-02-10T12:00:00.000Z',
		...overrides
	};
}

export function makeEntry(
	overrides: Partial<Omit<DerivedPaymentEntry, 'expense'>> & { expense?: Partial<Expense> } = {}
): DerivedPaymentEntry {
	const { expense, ...rest } = overrides;
	return {
		paymentNumber: 1,
		remainingBalance: 19_700,
		principalAmount: 300,
		interestAmount: 100,
		paymentType: 'standard',
		...rest,
		expense: makeExpense(expense)
	};
}
