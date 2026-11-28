import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/svelte';
import type { UnitPreferences, VehicleFinancing } from '#lib/types/index.ts';
import type { AmortizationEntry } from '#lib/utils/financing-calculations.ts';
import { makeLease, makeLoan } from './financing-fixtures';

const store = vi.hoisted(() => ({ currencyUnit: 'USD' }));

vi.mock('#lib/stores/settings.svelte.ts', () => ({
	settingsStore: {
		get settings() {
			return { currencyUnit: store.currencyUnit };
		},
		get unitPreferences() {
			return { distanceUnit: 'miles', volumeUnit: 'gallons_us', chargeUnit: 'kwh' };
		}
	}
}));

import PaymentMetricsGrid from '../PaymentMetricsGrid.svelte';

const KM: UnitPreferences = { distanceUnit: 'kilometers', volumeUnit: 'liters', chargeUnit: 'kwh' };

function scheduleEntry(paymentNumber: number, interestAmount: number): AmortizationEntry {
	return {
		paymentNumber,
		paymentDate: new Date(2025, paymentNumber, 10),
		paymentAmount: 400,
		principalAmount: 400 - interestAmount,
		interestAmount,
		remainingBalance: 0,
		isPaid: false
	};
}

function mount(
	props: {
		financing?: VehicleFinancing;
		paymentsCount?: number;
		amortizationSchedule?: AmortizationEntry[];
		mileageUsed?: number;
		unitPreferences?: UnitPreferences;
	} = {}
) {
	return render(PaymentMetricsGrid, {
		props: {
			financing: props.financing ?? makeLoan(),
			totalInterestPaid: 250.5,
			totalPrincipalPaid: 4_749.5,
			estimatedPayoffDate: new Date(2029, 0, 10, 12),
			paymentsCount: props.paymentsCount ?? 12,
			amortizationSchedule: props.amortizationSchedule,
			mileageUsed: props.mileageUsed,
			unitPreferences: props.unitPreferences
		}
	});
}

afterEach(() => {
	cleanup();
	store.currencyUnit = 'USD';
});

describe('PaymentMetricsGrid for a loan with APR', () => {
	test('shows principal paid with the interest paid alongside it', () => {
		mount();
		expect(screen.getByText('Principal vs interest')).toBeTruthy();
		expect(screen.getByText('$4,749.50')).toBeTruthy();
		expect(screen.getByText('+ $250.50 interest')).toBeTruthy();
	});

	test('shows payments made against the scheduled term', () => {
		mount();
		expect(screen.getByText('Payments made')).toBeTruthy();
		expect(screen.getByText('12')).toBeTruthy();
		expect(screen.getByText('of 60 scheduled')).toBeTruthy();
	});

	test('shows the estimated payoff date and the months left in the term', () => {
		mount();
		expect(screen.getByText('Estimated payoff')).toBeTruthy();
		expect(screen.getByText('Jan 10, 2029')).toBeTruthy();
		expect(screen.getByText('48 months remaining')).toBeTruthy();
	});

	test('uses the singular for one month remaining and never goes below zero', () => {
		mount({ paymentsCount: 59 });
		expect(screen.getByText('1 month remaining')).toBeTruthy();
		cleanup();
		mount({ paymentsCount: 75 });
		expect(screen.getByText('0 months remaining')).toBeTruthy();
	});

	test('total cost adds the projected schedule interest to the original amount', () => {
		mount({
			amortizationSchedule: [
				scheduleEntry(1, 1_000),
				scheduleEntry(2, 1_500),
				scheduleEntry(3, 500)
			]
		});
		expect(screen.getByText('Total cost of loan')).toBeTruthy();
		expect(screen.getByText('$23,000.00')).toBeTruthy();
		expect(screen.getByText('15% over principal')).toBeTruthy();
	});

	test('formats every amount in the user currency', () => {
		store.currencyUnit = 'EUR';
		mount({ amortizationSchedule: [scheduleEntry(1, 2_000)] });
		expect(screen.getByText('€4,749.50')).toBeTruthy();
		expect(screen.getByText('+ €250.50 interest')).toBeTruthy();
		expect(screen.getByText('€22,000.00')).toBeTruthy();
		expect(screen.queryByText(/\$/)).toBeNull();
	});

	test('a zero-decimal currency drops the cents', () => {
		store.currencyUnit = 'JPY';
		mount();
		expect(screen.getByText('¥4,750')).toBeTruthy();
		expect(screen.getByText('+ ¥251 interest')).toBeTruthy();
	});
});

describe('PaymentMetricsGrid for a zero-APR loan', () => {
	test('omits the interest and total-cost cards', () => {
		mount({ financing: makeLoan({ apr: 0 }), amortizationSchedule: [scheduleEntry(1, 100)] });
		expect(screen.queryByText('Principal vs interest')).toBeNull();
		expect(screen.queryByText('Total cost of loan')).toBeNull();
		expect(screen.getByText('Payments made')).toBeTruthy();
		expect(screen.getByText('Estimated payoff')).toBeTruthy();
	});
});

describe('PaymentMetricsGrid for a lease', () => {
	test('labels the end date as the lease end and shows the buyout value', () => {
		mount({ financing: makeLease({ residualValue: 18_500 }), paymentsCount: 12 });
		expect(screen.getByText('Lease end date')).toBeTruthy();
		expect(screen.queryByText('Estimated payoff')).toBeNull();
		expect(screen.getByText('24 months remaining')).toBeTruthy();
		expect(screen.getByText('Residual value (buyout)')).toBeTruthy();
		expect(screen.getByText('$18,500.00')).toBeTruthy();
		expect(screen.queryByText('Total cost of loan')).toBeNull();
	});

	test('omits the buyout card when no residual value is recorded', () => {
		mount({ financing: makeLease({ residualValue: undefined }) });
		expect(screen.queryByText('Residual value (buyout)')).toBeNull();
	});

	test('prices miles over the term allowance at the excess fee', () => {
		mount({ financing: makeLease(), mileageUsed: 40_000 });
		expect(screen.getByText('Mileage overage')).toBeTruthy();
		expect(screen.getByText('$1,000.00')).toBeTruthy();
		expect(screen.getByText('4,000 mi over · $0.25/mi')).toBeTruthy();
	});

	test('reports zero overage while within the allowance', () => {
		mount({ financing: makeLease(), mileageUsed: 36_000 });
		expect(screen.getByText('$0.00')).toBeTruthy();
		expect(screen.getByText('Within limit · $0.25/mi')).toBeTruthy();
	});

	test('labels the overage in the vehicle distance unit and user currency', () => {
		store.currencyUnit = 'GBP';
		mount({ financing: makeLease(), mileageUsed: 37_000, unitPreferences: KM });
		expect(screen.getByText('£250.00')).toBeTruthy();
		expect(screen.getByText('1,000 km over · £0.25/km')).toBeTruthy();
	});

	test.each<[string, Partial<VehicleFinancing>]>([
		['no mileage limit', { mileageLimit: undefined }],
		['no excess fee', { excessMileageFee: undefined }]
	])('omits the overage card with %s', (_label, overrides) => {
		mount({ financing: makeLease(overrides), mileageUsed: 99_000 });
		expect(screen.queryByText('Mileage overage')).toBeNull();
	});
});
