import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import type { FinancingFormErrors, Vehicle, VehicleFinancing } from '#lib/types/index.ts';
import { makeLoan } from '#lib/components/financing/__tests__/financing-fixtures';

const store = vi.hoisted(() => ({ currencyUnit: 'USD' }));

vi.mock('#lib/stores/settings.svelte.ts', () => ({
	settingsStore: {
		get settings() {
			return { currencyUnit: store.currencyUnit };
		}
	}
}));

import FinancingFormSection from '../FinancingFormSection.svelte';

type Ownership = 'own' | 'lease' | 'finance';

function form(overrides: Record<string, unknown> = {}) {
	return {
		financingType: 'loan' as const,
		provider: 'Chase',
		originalAmount: 20_000,
		apr: 6,
		termMonths: 60,
		startDate: '2025-01-15',
		paymentAmount: 386.66,
		frequency: 'monthly' as const,
		dayOfMonth: 15,
		residualValue: undefined,
		mileageLimit: undefined,
		excessMileageFee: undefined,
		...overrides
	};
}

function vehicleWith(financing: VehicleFinancing): Vehicle {
	return {
		id: 'v1',
		make: 'Honda',
		model: 'Civic',
		year: 2023,
		vehicleType: 'gas',
		trackFuel: true,
		trackCharging: false,
		financing,
		createdAt: '2024-01-01T00:00:00.000Z',
		updatedAt: '2024-01-01T00:00:00.000Z'
	};
}

const PREVIEW = {
	monthlyPayment: 386.66,
	totalInterest: 3_199.6,
	totalPayments: 23_199.6,
	payoffDate: new Date(2030, 0, 15, 12)
};

function mount(
	props: {
		ownershipType?: Ownership;
		financingForm?: ReturnType<typeof form>;
		errors?: FinancingFormErrors;
		isEditMode?: boolean;
		vehicle?: Vehicle | null;
		amortizationPreview?: typeof PREVIEW | null;
	} = {}
) {
	return render(FinancingFormSection, {
		props: {
			ownershipType: props.ownershipType ?? 'finance',
			financingForm: props.financingForm ?? form(),
			errors: props.errors ?? {},
			isEditMode: props.isEditMode ?? false,
			vehicle: props.vehicle ?? null,
			amortizationPreview: props.amortizationPreview ?? null
		}
	});
}

async function settle(): Promise<void> {
	for (let i = 0; i < 10; i++) {
		await new Promise(resolve => setTimeout(resolve, 0));
	}
}

async function pickOption(trigger: HTMLElement, optionName: string): Promise<void> {
	await fireEvent.click(trigger);
	await settle();
	await fireEvent.pointerUp(screen.getByRole('option', { name: optionName }));
	await settle();
}

afterEach(() => {
	cleanup();
	store.currencyUnit = 'USD';
});

describe('FinancingFormSection ownership', () => {
	test('an owned vehicle shows no financing fields', () => {
		mount({ ownershipType: 'own' });
		expect(screen.getByText('This vehicle is owned outright')).toBeTruthy();
		expect(screen.getByText(/owned outright with no financing or lease/)).toBeTruthy();
		expect(screen.queryByLabelText(/Lender|Leasing Company/)).toBeNull();
	});

	test('a financed vehicle asks for the lender, loan amount and APR but no lease terms', () => {
		mount({ ownershipType: 'finance' });
		expect(screen.getByText('Loan details and payment information')).toBeTruthy();
		expect(screen.getByLabelText(/Lender/)).toBeTruthy();
		expect(screen.getByLabelText(/^Loan Amount/)).toBeTruthy();
		expect(screen.getByLabelText(/APR/)).toBeTruthy();
		expect(screen.queryByLabelText(/Monthly Payment/)).toBeNull();
		expect(screen.queryByLabelText(/Residual Value/)).toBeNull();
		expect(screen.queryByLabelText(/Mileage Limit/)).toBeNull();
	});

	test('the start date label points at the date picker button', () => {
		mount({ ownershipType: 'finance' });
		expect(screen.getByLabelText(/Start Date/).tagName).toBe('BUTTON');
	});

	test('a leased vehicle asks for the payment, residual and mileage terms but no APR', () => {
		mount({ ownershipType: 'lease' });
		expect(screen.getByText('Lease details and payment information')).toBeTruthy();
		expect(screen.getByLabelText(/Leasing Company/)).toBeTruthy();
		expect(screen.getByLabelText(/^Total Lease Obligation/)).toBeTruthy();
		expect(screen.getByLabelText(/Monthly Payment/)).toBeTruthy();
		expect(screen.getByLabelText(/Residual Value/)).toBeTruthy();
		expect(screen.getByLabelText(/Annual Mileage Limit/)).toBeTruthy();
		expect(screen.getByLabelText(/Excess Mileage Fee/)).toBeTruthy();
		expect(screen.queryByLabelText(/APR/)).toBeNull();
	});

	test('switching ownership swaps the fields shown', async () => {
		mount({ ownershipType: 'own' });
		await fireEvent.click(screen.getByRole('button', { name: 'Lease' }));
		expect(screen.getByLabelText(/Leasing Company/)).toBeTruthy();
		await fireEvent.click(screen.getByRole('button', { name: 'Finance' }));
		expect(screen.getByLabelText(/Lender/)).toBeTruthy();
		expect(screen.queryByLabelText(/Residual Value/)).toBeNull();
		await fireEvent.click(screen.getByRole('button', { name: 'Own' }));
		expect(screen.queryByLabelText(/Lender/)).toBeNull();
	});

	test('prefills the inputs from the form values', () => {
		mount({
			ownershipType: 'lease',
			financingForm: form({
				provider: 'Toyota Financial',
				originalAmount: 14_400,
				paymentAmount: 400,
				residualValue: 18_500,
				mileageLimit: 12_000,
				excessMileageFee: 0.25
			})
		});
		expect((screen.getByLabelText(/Leasing Company/) as HTMLInputElement).value).toBe(
			'Toyota Financial'
		);
		expect((screen.getByLabelText(/Monthly Payment/) as HTMLInputElement).value).toBe('400');
		expect((screen.getByLabelText(/Residual Value/) as HTMLInputElement).value).toBe('18500');
		expect((screen.getByLabelText(/Annual Mileage Limit/) as HTMLInputElement).value).toBe('12000');
		expect((screen.getByLabelText(/Excess Mileage Fee/) as HTMLInputElement).value).toBe('0.25');
	});
});

describe('FinancingFormSection term and payment day', () => {
	test('shows the term in months and years', () => {
		mount({ financingForm: form({ termMonths: 60 }) });
		expect(screen.getByText('60 months (5 years)')).toBeTruthy();
	});

	test('choosing a term updates the form', async () => {
		const financingForm = form({ termMonths: 60 });
		mount({ financingForm });
		await pickOption(screen.getByText('60 months (5 years)'), '72 months (6 years)');
		expect(financingForm.termMonths).toBe(72);
	});

	test('choosing a payment day updates the form', async () => {
		const financingForm = form({ dayOfMonth: 15 });
		mount({ financingForm });
		const trigger = document.getElementById('dayOfMonth')!;
		await pickOption(trigger, '28');
		expect(financingForm.dayOfMonth).toBe(28);
	});
});

describe('FinancingFormSection validation errors', () => {
	test('shows each field error next to its field and marks the input invalid', () => {
		mount({
			ownershipType: 'lease',
			errors: {
				provider: 'Provider is required',
				originalAmount: 'Amount must be positive',
				termMonths: 'Pick a term',
				startDate: 'Start date is required',
				paymentAmount: 'Payment must be at least $0.01'
			}
		});
		expect(screen.getByText('Provider is required')).toBeTruthy();
		expect(screen.getByText('Amount must be positive')).toBeTruthy();
		expect(screen.getByText('Pick a term')).toBeTruthy();
		expect(screen.getByText('Start date is required')).toBeTruthy();
		expect(screen.getByText('Payment must be at least $0.01')).toBeTruthy();
		const payment = screen.getByLabelText(/Monthly Payment/);
		expect(payment.getAttribute('aria-invalid')).toBe('true');
		expect(payment.getAttribute('aria-describedby')).toBe('paymentAmount-error');
		expect(screen.getByLabelText(/Leasing Company/).getAttribute('aria-invalid')).toBe('true');
	});

	test('each invalid field is described by its own error', () => {
		mount({
			errors: {
				provider: 'Provider is required',
				originalAmount: 'Amount must be positive',
				apr: 'APR is required',
				termMonths: 'Pick a term',
				startDate: 'Start date is required'
			}
		});
		expect(screen.getByLabelText(/Lender/)).toHaveAccessibleDescription('Provider is required');
		expect(screen.getByLabelText(/^Loan Amount/)).toHaveAccessibleDescription(
			'Amount must be positive'
		);
		expect(screen.getByLabelText(/APR/)).toHaveAccessibleDescription('APR is required');
		expect(document.getElementById('termMonths')).toHaveAccessibleDescription('Pick a term');
		const startDate = screen.getByLabelText(/Start Date/);
		expect(startDate).toHaveAccessibleDescription('January 15, 2025 Start date is required');
		expect(startDate.getAttribute('aria-invalid')).toBe('true');
	});

	test('shows the APR error for a loan', () => {
		mount({ errors: { apr: 'APR must be between 0 and 50' } });
		expect(screen.getByText('APR must be between 0 and 50')).toBeTruthy();
		expect(screen.getByLabelText(/APR/).getAttribute('aria-invalid')).toBe('true');
	});

	test('inputs without errors are not marked invalid', () => {
		mount({ ownershipType: 'lease' });
		const payment = screen.getByLabelText(/Monthly Payment/);
		expect(payment.getAttribute('aria-invalid')).toBe('false');
		expect(payment.getAttribute('aria-describedby')).toBeNull();
	});
});

describe('FinancingFormSection loan preview', () => {
	test('previews the payment, interest, total and payoff month for a new loan', () => {
		mount({ amortizationPreview: PREVIEW });
		expect(screen.getByText('Loan Calculation Preview')).toBeTruthy();
		expect(screen.getByText('$386.66')).toBeTruthy();
		expect(screen.getByText('$3,199.60')).toBeTruthy();
		expect(screen.getByText('$23,199.60')).toBeTruthy();
		expect(screen.getByText('Jan 2030')).toBeTruthy();
	});

	test('labels the preview as updated when editing', () => {
		mount({ amortizationPreview: PREVIEW, isEditMode: true });
		expect(screen.getByText('Updated Loan Calculation Preview')).toBeTruthy();
		expect(screen.getByLabelText(/^Original Loan Amount/)).toBeTruthy();
	});

	test('a lease never shows the loan preview', () => {
		mount({ ownershipType: 'lease', amortizationPreview: PREVIEW });
		expect(screen.queryByText(/Loan Calculation Preview/)).toBeNull();
	});

	test('formats the preview in the user currency', () => {
		store.currencyUnit = 'EUR';
		mount({ amortizationPreview: PREVIEW });
		expect(screen.getByText('€386.66')).toBeTruthy();
		expect(screen.getByText('€23,199.60')).toBeTruthy();
	});
});

describe('FinancingFormSection current status when editing', () => {
	test('shows the current balance, original amount and principal paid', () => {
		mount({ isEditMode: true, vehicle: vehicleWith(makeLoan({ computedBalance: 15_000 })) });
		expect(screen.getByText('Current Status')).toBeTruthy();
		expect(screen.getByText('$15,000.00')).toBeTruthy();
		expect(screen.getByText('$20,000.00')).toBeTruthy();
		expect(screen.getByText('$5,000.00')).toBeTruthy();
	});

	test('a balance grown above the original by interest shows no principal paid', () => {
		mount({ isEditMode: true, vehicle: vehicleWith(makeLoan({ computedBalance: 20_250 })) });
		expect(screen.getByText('$20,250.00')).toBeTruthy();
		expect(screen.getByText('$0.00')).toBeTruthy();
	});

	test('a paid-off loan shows the whole original as principal paid', () => {
		mount({ isEditMode: true, vehicle: vehicleWith(makeLoan({ computedBalance: 0 })) });
		expect(screen.getByText('$0.00')).toBeTruthy();
		expect(screen.getAllByText('$20,000.00')).toHaveLength(2);
	});

	test('is hidden when creating a vehicle or when no balance is known', () => {
		mount({ isEditMode: false, vehicle: vehicleWith(makeLoan()) });
		expect(screen.queryByText('Current Status')).toBeNull();
		cleanup();
		mount({ isEditMode: true, vehicle: vehicleWith(makeLoan({ computedBalance: undefined })) });
		expect(screen.queryByText('Current Status')).toBeNull();
	});
});
