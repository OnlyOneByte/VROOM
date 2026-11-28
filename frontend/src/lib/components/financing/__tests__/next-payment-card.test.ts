import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/svelte';
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
		showProgress?: boolean;
		onChangePayment?: () => void;
		isOwner?: boolean;
	} = {}
) {
	return render(NextPaymentCard, {
		props: { financing: props.financing ?? makeLoan(), ...props }
	});
}

function countdown(): HTMLElement {
	return screen.getByTestId('payment-countdown');
}

function rows(): string[] {
	const section = screen.getByRole('region', { name: 'Next payment' });
	return within(section)
		.getAllByRole('listitem')
		.map(li => (li.textContent ?? '').replace(/\s+/g, ' ').trim());
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

describe('Next payment due date', () => {
	test('after this month is paid the next monthly payment is due next month', () => {
		mount({ lastPayment: makeEntry({ expense: { date: localNoon(2025, 5, 10) } }) });
		const time = screen.getByText('Jul 10, 2025');
		expect(time.getAttribute('datetime')).toBe(new Date(2025, 6, 10, 12).toISOString());
		expect(countdown().textContent).toBe('Due in 25 days');
		expect(countdown().className).toContain('text-muted-foreground');
	});

	test('a payment due within a day reads as due tomorrow, in the warning colour', () => {
		mount({
			financing: makeLoan({ startDate: '2025-01-16T12:00:00' }),
			lastPayment: makeEntry({ expense: { date: localNoon(2025, 4, 16) } })
		});
		expect(screen.getByText('Jun 16, 2025')).toBeTruthy();
		expect(countdown().textContent).toBe('Due tomorrow');
		expect(countdown().className).toContain('text-destructive');
	});

	test('a weekly loan has its first payment due a week after the start and says weekly', () => {
		mount({
			financing: makeLoan({ paymentFrequency: 'weekly', startDate: '2025-06-10T12:00:00' })
		});
		expect(screen.getByText('Jun 17, 2025')).toBeTruthy();
		expect(countdown().textContent).toBe('Due in 2 days');
		expect(rows()[1]).toBe('Loan terms 6% APR · Weekly · 60 months');
	});

	test.each([
		[new Date(2025, 5, 12, 12), 'Overdue by 3 days'],
		[new Date(2025, 5, 14, 12), 'Overdue by 1 day']
	])('reports an overdue payment (%s)', (date, text) => {
		nextDateOverride.value = date;
		mount();
		expect(countdown().textContent).toBe(text);
	});
});

describe('Next payment amounts', () => {
	test('one row: the date, its principal and interest split, and the payment; then the terms', () => {
		mount({
			lastPayment: makeEntry({ expense: { date: localNoon(2025, 5, 10) } }),
			showProgress: false
		});
		expect(rows()).toEqual([
			'Jul 10, 2025 Due in 25 days $325.00 principal · $75.00 interest $400.00 Min: $386.66',
			'Loan terms 6% APR · 60 months'
		]);
		expect(screen.getByTestId('payment-amount').textContent?.trim()).toBe('$400.00');
	});

	test('paying exactly the minimum shows no minimum', () => {
		mount({ financing: makeLoan({ paymentAmount: 386.66 }) });
		expect(screen.queryByText(/Min:/)).toBeNull();
	});

	test('a payment smaller than the month’s interest says so, rather than $0 principal', () => {
		mount({ financing: makeLoan({ apr: 36, paymentAmount: 400 }), showProgress: false });
		expect(rows()[0]).toContain("Doesn't cover this month's $450.00 interest");
		expect(rows()[0]).not.toContain('principal');
	});

	test('a payment of exactly the month’s interest says it covers only the interest', () => {
		mount({
			financing: makeLoan({ apr: 36, paymentAmount: 450, computedBalance: 15_000 }),
			showProgress: false
		});
		expect(rows()[0]).toContain("Covers only this month's $450.00 interest");
		expect(rows()[0]).not.toContain('principal');
	});

	test('the countdown is plain text, not a live region, and the amount has no replacing label', () => {
		const { container } = mount();
		expect(screen.queryByRole('status')).toBeNull();
		expect(container.querySelector('[aria-live]')).toBeNull();
		expect(screen.getByTestId('payment-amount').getAttribute('aria-label')).toBeNull();
	});

	test('a zero-APR loan has no minimum, no split and no APR', () => {
		mount({ financing: makeLoan({ apr: 0 }) });
		expect(screen.queryByText(/Min:|principal|APR/)).toBeNull();
	});

	test('a weekly loan shows no split, since interest accrues monthly', () => {
		mount({ financing: makeLoan({ paymentFrequency: 'weekly' }) });
		expect(screen.queryByText(/principal/)).toBeNull();
	});

	test('the loan progress is not repeated here: the hero shows it', () => {
		mount({ showProgress: false });
		expect(screen.queryByText('Paid so far')).toBeNull();
		expect(screen.queryByRole('progressbar')).toBeNull();
	});

	test('a lease shows what is paid so far, rounded, with the exact value on the progress role', () => {
		mount({ financing: makeLease() });
		expect(rows()).toContain('Paid so far $4,800.00 of $14,400.00 · $9,600.00 left 33%');
		expect(
			screen.getByRole('progressbar', { name: 'Payment progress' }).getAttribute('aria-valuenow')
		).toMatch(/^33\.33/);
		expect(rows()[1]).toBe('Lease terms 36 months');
	});

	test('a balance grown above the original shows nothing paid', () => {
		mount({ financing: makeLease({ computedBalance: 14_500 }) });
		expect(rows()).toContain('Paid so far $0.00 of $14,400.00 · $14,500.00 left 0%');
	});

	test('an unknown balance counts as nothing paid yet', () => {
		mount({ financing: makeLease({ computedBalance: undefined }) });
		expect(rows()).toContain('Paid so far $0.00 of $14,400.00 · $14,400.00 left 0%');
	});

	test('formats amounts in the user currency', () => {
		store.currencyUnit = 'EUR';
		mount();
		expect(screen.getByTestId('payment-amount').textContent?.trim()).toBe('€400.00');
		expect(screen.getByText('Min: €386.66')).toBeTruthy();
		expect(screen.queryByText(/\$/)).toBeNull();
	});
});

describe('Next payment actions', () => {
	test('an owner can record a payment and open the planner for a loan', async () => {
		const onChangePayment = vi.fn();
		mount({ recordPaymentHref: '/expenses/new?vehicleId=v1', onChangePayment });
		expect(screen.getByRole('link', { name: 'Record payment' }).getAttribute('href')).toBe(
			'/expenses/new?vehicleId=v1'
		);
		expect(screen.getByText('Paying extra?')).toBeTruthy();
		await fireEvent.click(screen.getByRole('button', { name: 'Payment planner' }));
		expect(onChangePayment).toHaveBeenCalledTimes(1);
	});

	test('a lease can record a payment but has no planner', () => {
		mount({ financing: makeLease(), recordPaymentHref: '/x', onChangePayment: vi.fn() });
		expect(screen.getByRole('link', { name: 'Record payment' })).toBeTruthy();
		expect(screen.queryByRole('button', { name: 'Payment planner' })).toBeNull();
		expect(screen.queryByText('Paying extra?')).toBeNull();
	});

	test('a viewer sees no actions', () => {
		mount({ recordPaymentHref: '/x', onChangePayment: vi.fn(), isOwner: false });
		expect(screen.queryByRole('link')).toBeNull();
		expect(screen.queryByRole('button')).toBeNull();
	});

	test('no actions render without a link or handler', () => {
		mount();
		expect(screen.queryByRole('link')).toBeNull();
		expect(screen.queryByRole('button')).toBeNull();
	});
});
