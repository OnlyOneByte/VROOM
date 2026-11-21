import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import type { DerivedPaymentEntry, VehicleFinancing } from '#lib/types/index.ts';
import { localNoon, makeEntry, makeLease, makeLoan } from './financing-fixtures';

const store = vi.hoisted(() => ({ currencyUnit: 'USD' }));
const nextDateOverride = vi.hoisted(() => ({ value: null as Date | null }));

vi.mock('#lib/stores/settings.svelte.ts', () => ({
	settingsStore: {
		get settings() {
			return { currencyUnit: store.currencyUnit };
		}
	}
}));

vi.mock('#lib/utils/financing-calculations.ts', async importOriginal => {
	const actual = await importOriginal<typeof import('#lib/utils/financing-calculations.ts')>();
	return {
		...actual,
		calculateNextPaymentDate: (financing: VehicleFinancing, lastPaymentDate?: Date) =>
			nextDateOverride.value ?? actual.calculateNextPaymentDate(financing, lastPaymentDate)
	};
});

import NextPaymentCard from '../NextPaymentCard.svelte';

const NOW = new Date(2025, 5, 15, 12, 0, 0);

function mount(
	props: {
		financing?: VehicleFinancing;
		lastPayment?: DerivedPaymentEntry;
		recordPaymentHref?: string;
		progressPercentage?: number;
		onChangePayment?: () => void;
		isOwner?: boolean;
	} = {}
) {
	return render(NextPaymentCard, {
		props: { financing: props.financing ?? makeLoan(), ...props }
	});
}

function countdown(): string {
	return screen.getByRole('status').textContent?.trim() ?? '';
}

beforeEach(() => {
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(NOW);
});

afterEach(() => {
	cleanup();
	vi.useRealTimers();
	store.currencyUnit = 'USD';
	nextDateOverride.value = null;
});

describe('NextPaymentCard due date', () => {
	test('after this month is paid the next monthly payment is due next month', () => {
		mount({ lastPayment: makeEntry({ expense: { date: localNoon(2025, 5, 10) } }) });
		expect(screen.getByText('Jul 10, 2025')).toBeTruthy();
		expect(screen.getByText('Jul 10, 2025').getAttribute('datetime')).toBe(
			new Date(2025, 6, 10, 12).toISOString()
		);
		expect(countdown()).toBe('Due in 25 days');
	});

	test('a payment due within a day reads as due tomorrow', () => {
		mount({
			financing: makeLoan({ startDate: '2025-01-16T12:00:00' }),
			lastPayment: makeEntry({ expense: { date: localNoon(2025, 4, 16) } })
		});
		expect(screen.getByText('Jun 16, 2025')).toBeTruthy();
		expect(countdown()).toBe('Due tomorrow');
	});

	test('a weekly loan that started this week has its first payment due a week after the start', () => {
		mount({
			financing: makeLoan({ paymentFrequency: 'weekly', startDate: '2025-06-10T12:00:00' })
		});
		expect(screen.getByText('Jun 17, 2025')).toBeTruthy();
		expect(countdown()).toBe('Due in 2 days');
		expect(screen.getByText('Weekly')).toBeTruthy();
	});

	test('reports how many days a payment is overdue', () => {
		nextDateOverride.value = new Date(2025, 5, 12, 12);
		mount();
		expect(countdown()).toBe('Overdue by 3 days');
		expect(screen.getByText('Jun 12, 2025')).toBeTruthy();
	});

	test('uses the singular for a payment one day overdue', () => {
		nextDateOverride.value = new Date(2025, 5, 14, 12);
		mount();
		expect(countdown()).toBe('Overdue by 1 day');
	});
});

describe('NextPaymentCard amounts', () => {
	test('shows the payment, frequency, loan type and APR', () => {
		mount();
		expect(screen.getByLabelText('Payment amount').textContent).toBe('$400.00');
		expect(screen.getByText('Monthly')).toBeTruthy();
		expect(screen.getByText('Loan Payment')).toBeTruthy();
		expect(screen.getByText('6% APR')).toBeTruthy();
	});

	test('shows the minimum payment when paying above it', () => {
		mount();
		expect(screen.getByText('Min: $386.66')).toBeTruthy();
	});

	test('hides the minimum when paying exactly the minimum', () => {
		mount({ financing: makeLoan({ paymentAmount: 386.66 }) });
		expect(screen.queryByText(/Min:/)).toBeNull();
	});

	test('a zero-APR loan has no minimum and no APR line', () => {
		mount({ financing: makeLoan({ apr: 0 }) });
		expect(screen.queryByText(/Min:/)).toBeNull();
		expect(screen.queryByText(/APR/)).toBeNull();
	});

	test('shows original, principal paid and remaining balance', () => {
		mount();
		expect(screen.getByText('$20,000.00')).toBeTruthy();
		expect(screen.getByText('$5,000.00')).toBeTruthy();
		expect(screen.getByText('$15,000.00')).toBeTruthy();
	});

	test('a balance grown above the original by interest shows no principal paid', () => {
		mount({ financing: makeLoan({ computedBalance: 20_150 }) });
		expect(screen.getByText('$0.00')).toBeTruthy();
		expect(screen.getByText('$20,150.00')).toBeTruthy();
	});

	test('a final paid-off balance shows the whole original as paid', () => {
		mount({ financing: makeLoan({ computedBalance: 0 }), progressPercentage: 100 });
		expect(screen.getAllByText('$20,000.00')).toHaveLength(2);
		expect(screen.getByText('$0.00')).toBeTruthy();
		expect(screen.getByText('100%')).toBeTruthy();
	});

	test('formats amounts in the user currency', () => {
		store.currencyUnit = 'EUR';
		mount();
		expect(screen.getByLabelText('Payment amount').textContent).toBe('€400.00');
		expect(screen.getByText('Min: €386.66')).toBeTruthy();
		expect(screen.getByText('€15,000.00')).toBeTruthy();
		expect(screen.queryByText(/\$/)).toBeNull();
	});

	test('rounds the progress percentage and reports it on the progress bar', () => {
		mount({ progressPercentage: 33.4 });
		expect(screen.getByText('33%')).toBeTruthy();
		expect(
			screen.getByRole('progressbar', { name: 'Payment progress' }).getAttribute('aria-valuenow')
		).toBe('33.4');
	});
});

describe('NextPaymentCard actions', () => {
	test('an owner can record a payment and open the planner for a loan', async () => {
		const onChangePayment = vi.fn();
		mount({ recordPaymentHref: '/expenses/new?vehicleId=v1', onChangePayment });
		expect(screen.getByRole('link', { name: /Record Payment/ }).getAttribute('href')).toBe(
			'/expenses/new?vehicleId=v1'
		);
		await fireEvent.click(screen.getByRole('button', { name: /Change Payment/ }));
		expect(onChangePayment).toHaveBeenCalledTimes(1);
	});

	test('a lease cannot change its payment', () => {
		mount({ financing: makeLease(), recordPaymentHref: '/x', onChangePayment: vi.fn() });
		expect(screen.getByText('Lease Payment')).toBeTruthy();
		expect(screen.getByRole('link', { name: /Record Payment/ })).toBeTruthy();
		expect(screen.queryByRole('button', { name: /Change Payment/ })).toBeNull();
	});

	test('a viewer sees no actions', () => {
		mount({ recordPaymentHref: '/x', onChangePayment: vi.fn(), isOwner: false });
		expect(screen.queryByRole('link', { name: /Record Payment/ })).toBeNull();
		expect(screen.queryByRole('button', { name: /Change Payment/ })).toBeNull();
	});

	test('no actions render without a link or handler', () => {
		mount();
		expect(screen.queryByRole('link')).toBeNull();
		expect(screen.queryByRole('button')).toBeNull();
	});
});

describe('NextPaymentCard with no computed balance', () => {
	test('treats an unknown balance as nothing paid yet, matching the Finance tab progress', () => {
		mount({ financing: makeLoan({ computedBalance: undefined }), progressPercentage: 0 });

		const paid = screen.getByText('Principal paid').nextElementSibling;
		const remaining = screen.getByText('Remaining').nextElementSibling;
		expect(paid?.textContent?.trim()).toBe('$0.00');
		expect(remaining?.textContent?.trim()).toBe('$20,000.00');
	});
});
