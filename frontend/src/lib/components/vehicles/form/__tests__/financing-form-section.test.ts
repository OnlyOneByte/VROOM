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
		distanceUnit?: 'miles' | 'kilometers';
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
			distanceUnit: props.distanceUnit ?? 'miles',
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
		expect(screen.getByRole('switch', { name: 'This car has a loan or lease' })).toHaveAttribute(
			'aria-checked',
			'false'
		);
		expect(screen.queryByRole('group', { name: 'Which one?' })).toBeNull();
		expect(screen.queryByLabelText(/Lender|Leasing company/)).toBeNull();
		expect(screen.queryByText(/owned outright/)).toBeNull();
	});

	test('a financed vehicle asks for the lender, loan amount and APR but no lease terms', () => {
		mount({ ownershipType: 'finance' });
		expect(screen.getByRole('switch', { name: 'This car has a loan or lease' })).toHaveAttribute(
			'aria-checked',
			'true'
		);
		expect(screen.getByRole('radio', { name: 'Loan' })).toBeChecked();
		expect(screen.getByLabelText(/Lender/)).toBeTruthy();
		expect(screen.getByLabelText(/^Loan amount/)).toBeTruthy();
		expect(screen.getByLabelText(/APR/)).toBeTruthy();
		expect(screen.queryByLabelText(/Monthly payment/)).toBeNull();
		expect(screen.queryByLabelText(/Residual value/)).toBeNull();
		expect(screen.queryByLabelText(/mileage limit/)).toBeNull();
	});

	test('the start date label points at the date picker button', () => {
		mount({ ownershipType: 'finance' });
		expect(screen.getByLabelText(/Start date/).tagName).toBe('BUTTON');
	});

	test('a leased vehicle asks for the payment, residual and mileage terms but no APR', () => {
		mount({ ownershipType: 'lease' });
		expect(screen.getByRole('radio', { name: 'Lease' })).toBeChecked();
		expect(screen.getByLabelText(/Leasing company/)).toBeTruthy();
		expect(screen.getByLabelText(/^Total lease obligation/)).toBeTruthy();
		expect(screen.getByLabelText(/Monthly payment/)).toBeTruthy();
		expect(screen.getByLabelText(/Residual value/)).toBeTruthy();
		expect(screen.getByLabelText(/Yearly mileage limit/)).toBeTruthy();
		expect(screen.getByLabelText(/Fee per extra/)).toBeTruthy();
		expect(screen.queryByLabelText(/APR/)).toBeNull();
	});

	test.each([
		['miles', 'mi', 'e.g., 12000'],
		['kilometers', 'km', 'e.g., 20000']
	] as const)(
		'a %s vehicle labels the lease distance terms in %s',
		(distanceUnit, short, example) => {
			mount({ ownershipType: 'lease', distanceUnit });
			const limit = screen.getByLabelText(`Yearly mileage limit (${short}) (optional)`);
			expect(limit.getAttribute('placeholder')).toBe(example);
			expect(screen.getByLabelText(`Fee per extra ${short} (optional)`)).toBeTruthy();
			expect(screen.queryByText(/per mile\b/)).toBeNull();
		}
	);

	test('the switch reveals Loan or Lease, and turning it back on keeps the last choice', async () => {
		mount({ ownershipType: 'own' });
		await fireEvent.click(screen.getByRole('switch', { name: 'This car has a loan or lease' }));
		expect(screen.getByLabelText(/Lender/)).toBeTruthy();
		await fireEvent.click(screen.getByRole('radio', { name: 'Lease' }));
		expect(screen.getByLabelText(/Leasing company/)).toBeTruthy();
		expect(screen.queryByLabelText(/APR/)).toBeNull();
		await fireEvent.click(screen.getByRole('switch', { name: 'This car has a loan or lease' }));
		expect(screen.queryByLabelText(/Leasing company/)).toBeNull();
		await fireEvent.click(screen.getByRole('switch', { name: 'This car has a loan or lease' }));
		expect(screen.getByRole('radio', { name: 'Lease' })).toBeChecked();
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
		expect((screen.getByLabelText(/Leasing company/) as HTMLInputElement).value).toBe(
			'Toyota Financial'
		);
		expect((screen.getByLabelText(/Monthly payment/) as HTMLInputElement).value).toBe('400');
		expect((screen.getByLabelText(/Residual value/) as HTMLInputElement).value).toBe('18500');
		expect((screen.getByLabelText(/Yearly mileage limit/) as HTMLInputElement).value).toBe('12000');
		expect((screen.getByLabelText(/Fee per extra/) as HTMLInputElement).value).toBe('0.25');
	});
});

describe('FinancingFormSection amount inputs follow the currency', () => {
	const amountIds = ['originalAmount', 'paymentAmount', 'residualValue', 'excessMileageFee'];

	test('a JPY user steps money in whole yen, while APR keeps its decimals', () => {
		store.currencyUnit = 'JPY';
		mount({ ownershipType: 'lease' });
		for (const id of amountIds) {
			expect(document.getElementById(id)?.getAttribute('step')).toBe('1');
		}
		expect(document.getElementById('paymentAmount')?.getAttribute('min')).toBe('1');
		expect(document.getElementById('originalAmount')?.getAttribute('placeholder')).toBe('0');
		expect(document.getElementById('paymentAmount')?.getAttribute('placeholder')).toBe('0');
		expect(document.getElementById('excessMileageFee')?.getAttribute('placeholder')).toBe('0');
		cleanup();
		mount({ ownershipType: 'finance' });
		expect(document.getElementById('apr')?.getAttribute('step')).toBe('0.01');
	});

	test('a USD user keeps the cents step', () => {
		mount({ ownershipType: 'lease' });
		for (const id of amountIds) {
			expect(document.getElementById(id)?.getAttribute('step')).toBe('0.01');
		}
		expect(document.getElementById('paymentAmount')?.getAttribute('min')).toBe('0.01');
		expect(document.getElementById('paymentAmount')?.getAttribute('placeholder')).toBe('0.00');
		expect(document.getElementById('excessMileageFee')?.getAttribute('placeholder')).toBe('0.00');
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
		const payment = screen.getByLabelText(/Monthly payment/);
		expect(payment.getAttribute('aria-invalid')).toBe('true');
		expect(payment.getAttribute('aria-describedby')).toBe('paymentAmount-error');
		expect(screen.getByLabelText(/Leasing company/).getAttribute('aria-invalid')).toBe('true');
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
		expect(screen.getByLabelText(/^Loan amount/)).toHaveAccessibleDescription(
			'Amount must be positive'
		);
		expect(screen.getByLabelText(/APR/)).toHaveAccessibleDescription('APR is required');
		expect(document.getElementById('termMonths')).toHaveAccessibleDescription('Pick a term');
		const startDate = screen.getByLabelText(/Start date/);
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
		const payment = screen.getByLabelText(/Monthly payment/);
		expect(payment.getAttribute('aria-invalid')).toBe('false');
		expect(payment.getAttribute('aria-describedby')).toBeNull();
	});
});

describe('FinancingFormSection loan preview', () => {
	test('previews the payment, interest, total and payoff month for a new loan', () => {
		mount({ amortizationPreview: PREVIEW });
		expect(screen.getByText('Loan calculation preview')).toBeTruthy();
		for (const label of ['Monthly payment', 'Total interest', 'Total payments', 'Payoff date']) {
			expect(screen.getByText(label, { selector: 'p' })).toBeInTheDocument();
		}
		expect(screen.getByText('$386.66')).toBeTruthy();
		expect(screen.getByText('$3,199.60')).toBeTruthy();
		expect(screen.getByText('$23,199.60')).toBeTruthy();
		expect(screen.getByText('Jan 2030')).toBeTruthy();
	});

	test('labels the preview as updated when editing', () => {
		mount({ amortizationPreview: PREVIEW, isEditMode: true });
		expect(screen.getByText('Updated loan calculation preview')).toBeTruthy();
		expect(screen.getByLabelText(/^Original loan amount/)).toBeTruthy();
	});

	test('a lease never shows the loan preview', () => {
		mount({ ownershipType: 'lease', amortizationPreview: PREVIEW });
		expect(screen.queryByText(/loan calculation preview/i)).toBeNull();
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
		expect(screen.getByText('Current status')).toBeTruthy();
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
		expect(screen.queryByText('Current status')).toBeNull();
		cleanup();
		mount({ isEditMode: true, vehicle: vehicleWith(makeLoan({ computedBalance: undefined })) });
		expect(screen.queryByText('Current status')).toBeNull();
	});
});
