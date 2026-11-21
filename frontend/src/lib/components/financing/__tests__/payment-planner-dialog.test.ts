import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import type { VehicleFinancing } from '#lib/types/index.ts';
import { calculateExtraPaymentImpact } from '#lib/utils/financing-calculations.ts';
import { formatCurrency } from '#lib/utils/formatters.ts';
import { makeLoan } from './financing-fixtures';

const store = vi.hoisted(() => ({ currencyUnit: 'USD' }));

vi.mock('#lib/stores/settings.svelte.ts', () => ({
	settingsStore: {
		get settings() {
			return { currencyUnit: store.currencyUnit };
		}
	}
}));

import PaymentPlannerDialog from '../PaymentPlannerDialog.svelte';

const LOAN = makeLoan({
	originalAmount: 20_000,
	computedBalance: 15_000,
	apr: 6,
	termMonths: 60,
	paymentAmount: 400
});
const MINIMUM = 386.66;

function impactAt(payment: number) {
	return calculateExtraPaymentImpact({ ...LOAN, paymentAmount: MINIMUM }, payment - MINIMUM);
}

function mount(
	onPaymentAmountSaved: (amount: number) => Promise<void> = vi.fn(() => Promise.resolve()),
	financing: VehicleFinancing = LOAN
) {
	return render(PaymentPlannerDialog, {
		props: { financing, open: true, onPaymentAmountSaved }
	});
}

function paymentInput(): HTMLInputElement {
	return screen.getByLabelText(/Monthly Payment/) as HTMLInputElement;
}

function saveButton(): HTMLButtonElement {
	return screen.getByRole('button', { name: /Save|Saving/ }) as HTMLButtonElement;
}

async function enterPayment(value: string): Promise<void> {
	await fireEvent.input(paymentInput(), { target: { value } });
}

function months(n: number): string {
	return n === 1 ? '1 month' : `${n} months`;
}

beforeEach(() => {
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(new Date(2025, 5, 15, 12, 0, 0));
});

afterEach(() => {
	cleanup();
	vi.useRealTimers();
	store.currencyUnit = 'USD';
});

describe('PaymentPlannerDialog on open', () => {
	test('prefills the current payment and shows the minimum and current amounts', async () => {
		mount();
		expect(await screen.findByRole('dialog')).toBeTruthy();
		expect(paymentInput().value).toBe('400.00');
		expect(screen.getByText(/Min: \$386\.66 · Current: \$400\.00/)).toBeTruthy();
	});

	test('summarises what the current payment saves over the minimum', async () => {
		mount();
		await screen.findByRole('dialog');
		const impact = impactAt(400);
		expect(impact.monthsSaved).toBeGreaterThan(0);
		expect(impact.interestSaved).toBeGreaterThan(0);
		expect(
			screen.getByText(
				`Your current payment of $400.00/mo saves ${months(impact.monthsSaved)} and ${formatCurrency(impact.interestSaved)} vs the minimum.`
			)
		).toBeTruthy();
		expect(screen.getByText(formatCurrency(impact.interestSaved))).toBeTruthy();
		expect(screen.getByText(new RegExp(`^${impact.monthsSaved}\\s+mos?$`))).toBeTruthy();
	});

	test('saving is disabled until the amount changes', async () => {
		mount();
		await screen.findByRole('dialog');
		expect(saveButton().disabled).toBe(true);
	});
});

describe('PaymentPlannerDialog adjusting the payment', () => {
	test('a higher payment shows the extra savings against the current payment', async () => {
		mount();
		await screen.findByRole('dialog');
		await enterPayment('600');
		const raised = impactAt(600);
		const current = impactAt(400);
		const extraMonths = raised.monthsSaved - current.monthsSaved;
		await waitFor(() => expect(screen.getByText(`+${extraMonths} mo vs current`)).toBeTruthy());
		expect(
			screen.getByText(
				`+${formatCurrency(raised.interestSaved - current.interestSaved)} vs current`
			)
		).toBeTruthy();
		expect(
			screen.getByText(/^Paying \$600\.00\/mo saves .* more than your current \$400\.00\/mo\.$/)
		).toBeTruthy();
		expect(saveButton().disabled).toBe(false);
	});

	test('a lower payment above the minimum shows what is lost against the current payment', async () => {
		mount();
		await screen.findByRole('dialog');
		await enterPayment('390');
		const lowered = impactAt(390);
		const current = impactAt(400);
		const lostMonths = current.monthsSaved - lowered.monthsSaved;
		expect(current.interestSaved).toBeGreaterThan(lowered.interestSaved);
		await waitFor(() => expect(screen.getByText(`-${lostMonths} mo vs current`)).toBeTruthy());
		expect(
			screen.getByText(
				`-${formatCurrency(current.interestSaved - lowered.interestSaved)} vs current`
			)
		).toBeTruthy();
		expect(screen.getByText(/less than your current \$400\.00\/mo\.$/)).toBeTruthy();
		expect(saveButton().disabled).toBe(false);
	});

	test('a payment below the minimum is rejected and cannot be saved', async () => {
		mount();
		await screen.findByRole('dialog');
		await enterPayment('300');
		await waitFor(() => expect(screen.getByText('Minimum payment is $386.66')).toBeTruthy());
		expect(saveButton().disabled).toBe(true);
		expect(screen.queryByText(/vs current/)).toBeNull();
	});

	test('the minimum payment is accepted but reports no savings', async () => {
		mount();
		await screen.findByRole('dialog');
		await enterPayment('386.66');
		await waitFor(() =>
			expect(screen.getByText('This is the minimum payment. No extra savings.')).toBeTruthy()
		);
		expect(screen.queryByText(/vs current/)).toBeNull();
		expect(saveButton().disabled).toBe(false);
	});

	test('a cleared input counts as zero and cannot be saved', async () => {
		mount();
		await screen.findByRole('dialog');
		await enterPayment('');
		await waitFor(() => expect(screen.getByText('Minimum payment is $386.66')).toBeTruthy());
		expect(saveButton().disabled).toBe(true);
	});

	test('formats amounts in the user currency', async () => {
		store.currencyUnit = 'EUR';
		mount();
		await screen.findByRole('dialog');
		expect(screen.getByText(/Min: €386\.66 · Current: €400\.00/)).toBeTruthy();
		await enterPayment('300');
		await waitFor(() => expect(screen.getByText('Minimum payment is €386.66')).toBeTruthy());
	});
});

describe('PaymentPlannerDialog saving', () => {
	test('saves the new amount and closes the dialog', async () => {
		const onSaved = vi.fn(() => Promise.resolve());
		mount(onSaved);
		await screen.findByRole('dialog');
		await enterPayment('550.5');
		await fireEvent.click(saveButton());
		expect(onSaved).toHaveBeenCalledWith(550.5);
		await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
	});

	test('shows the error message and stays open when saving fails', async () => {
		mount(() => Promise.reject(new Error('Server rejected payment')));
		await screen.findByRole('dialog');
		await enterPayment('500');
		await fireEvent.click(saveButton());
		expect(await screen.findByText('Server rejected payment')).toBeTruthy();
		expect(screen.getByRole('dialog')).toBeTruthy();
		expect(saveButton().disabled).toBe(false);
	});

	test('falls back to a generic message for a non-Error failure', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		mount(() => Promise.reject('nope'));
		await screen.findByRole('dialog');
		await enterPayment('500');
		await fireEvent.click(saveButton());
		expect(
			await screen.findByText('Failed to save payment amount. Please try again.')
		).toBeTruthy();
	});

	test('disables the button while the save is in flight', async () => {
		let finish: () => void = () => {};
		mount(() => new Promise<void>(resolve => (finish = resolve)));
		await screen.findByRole('dialog');
		await enterPayment('500');
		await fireEvent.click(saveButton());
		expect(await screen.findByText(/Saving/)).toBeTruthy();
		expect(saveButton().disabled).toBe(true);
		finish();
		await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
	});
});
