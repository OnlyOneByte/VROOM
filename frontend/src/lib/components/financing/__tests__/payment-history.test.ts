import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/svelte';
import type { DerivedPaymentEntry, VehicleFinancing } from '#lib/types/index.ts';
import { derivePaymentEntries } from '#lib/utils/financing-calculations.ts';
import { makeEntry, makeExpense, makeLease, makeLoan } from './financing-fixtures';

const store = vi.hoisted(() => ({ currencyUnit: 'USD' }));

vi.mock('#lib/stores/settings.svelte.ts', () => ({
	settingsStore: {
		get settings() {
			return { currencyUnit: store.currencyUnit };
		}
	}
}));

import PaymentHistory from '../PaymentHistory.svelte';

function mount(payments: DerivedPaymentEntry[], financing: VehicleFinancing = makeLoan()) {
	return render(PaymentHistory, { props: { payments, financing } });
}

function paymentCards(): HTMLElement[] {
	return screen.getAllByRole('listitem');
}

function monthlyEntries(count: number): DerivedPaymentEntry[] {
	return Array.from({ length: count }, (_, i) =>
		makeEntry({
			paymentNumber: i + 1,
			expense: {
				id: `e${i + 1}`,
				date: new Date(Date.UTC(2015, i, 10, 12)).toISOString()
			}
		})
	);
}

afterEach(() => {
	cleanup();
	store.currencyUnit = 'USD';
});

describe('PaymentHistory empty state', () => {
	test('invites the user to record payments when there are none', () => {
		mount([]);
		expect(screen.getByRole('status').textContent).toMatch(/No Payment History/);
		expect(screen.queryByRole('list')).toBeNull();
	});
});

describe('PaymentHistory list', () => {
	test('lists payments newest first with a recorded count', () => {
		mount([
			makeEntry({ paymentNumber: 1, expense: { id: 'a', date: '2025-02-10T12:00:00.000Z' } }),
			makeEntry({ paymentNumber: 3, expense: { id: 'c', date: '2025-04-10T12:00:00.000Z' } }),
			makeEntry({ paymentNumber: 2, expense: { id: 'b', date: '2025-03-10T12:00:00.000Z' } })
		]);
		expect(screen.getByText(/3 payments recorded/)).toBeTruthy();
		const labels = paymentCards().map(
			card => within(card).getByLabelText(/^Payment number/).textContent
		);
		expect(labels).toEqual(['#3', '#2', '#1']);
		expect(screen.getByLabelText('Payment 3 on Apr 10, 2025')).toBeTruthy();
	});

	test('uses the singular for a single payment', () => {
		mount([makeEntry()]);
		expect(screen.getByText(/1 payment recorded/)).toBeTruthy();
		expect(screen.queryByText(/optimized view/)).toBeNull();
	});

	test('shows the date, amount and remaining balance of each payment', () => {
		mount([makeEntry({ remainingBalance: 19_700, expense: { amount: 400 } })]);
		const card = paymentCards()[0]!;
		const time = within(card).getByText('Feb 10, 2025');
		expect(time.getAttribute('datetime')).toBe('2025-02-10T12:00:00.000Z');
		expect(within(card).getByLabelText('Payment amount').textContent).toBe('$400.00');
		expect(within(card).getByText('$19,700.00')).toBeTruthy();
	});

	test('an interest-bearing loan breaks each payment into principal and interest', () => {
		mount([makeEntry({ principalAmount: 300, interestAmount: 100 })]);
		const breakdown = screen.getByRole('group', { name: 'Payment breakdown' });
		expect(within(breakdown).getByText('$300.00')).toBeTruthy();
		expect(within(breakdown).getByText('$100.00')).toBeTruthy();
	});

	test.each<[string, VehicleFinancing]>([
		['a zero-APR loan', makeLoan({ apr: 0 })],
		['a lease', makeLease()]
	])('%s shows no principal and interest breakdown', (_label, financing) => {
		mount([makeEntry()], financing);
		expect(screen.queryByRole('group', { name: 'Payment breakdown' })).toBeNull();
	});

	test('flags extra payments and leaves standard ones unflagged', () => {
		mount([
			makeEntry({ paymentType: 'extra', expense: { id: 'x', date: '2025-03-10T12:00:00.000Z' } }),
			makeEntry({ paymentType: 'standard', expense: { id: 's' } })
		]);
		const [extra, standard] = paymentCards();
		expect(within(extra!).getByLabelText('Extra payment indicator')).toBeTruthy();
		expect(within(standard!).queryByLabelText('Extra payment indicator')).toBeNull();
	});

	test('formats amounts in the user currency', () => {
		store.currencyUnit = 'EUR';
		mount([makeEntry({ remainingBalance: 19_700, expense: { amount: 400 } })]);
		expect(screen.getByLabelText('Payment amount').textContent).toBe('€400.00');
		expect(screen.getByText('€19,700.00')).toBeTruthy();
		expect(screen.getByText('€300.00')).toBeTruthy();
		expect(screen.queryByText(/\$/)).toBeNull();
	});

	test('renders the interest split and balances derived from real payments', () => {
		const financing = makeLoan({ apr: 12, originalAmount: 10_000, paymentAmount: 450 });
		const entries = derivePaymentEntries(
			[
				makeExpense({ id: 'p1', date: '2025-02-10T12:00:00.000Z', amount: 450 }),
				makeExpense({ id: 'p2', date: '2025-03-10T12:00:00.000Z', amount: 2_000 })
			],
			financing
		);
		mount(entries, financing);
		const [latest, first] = paymentCards();
		expect(within(latest!).getByLabelText('Payment amount').textContent).toBe('$2,000.00');
		expect(within(latest!).getByText('$96.50')).toBeTruthy();
		expect(within(latest!).getByText('$1,903.50')).toBeTruthy();
		expect(within(latest!).getByText('$7,746.50')).toBeTruthy();
		expect(within(latest!).getByLabelText('Extra payment indicator')).toBeTruthy();
		expect(within(first!).getByText('$9,650.00')).toBeTruthy();
		expect(within(first!).getByText('$100.00')).toBeTruthy();
	});
});

describe('PaymentHistory large history', () => {
	test('up to 100 payments render in full', () => {
		mount(monthlyEntries(100));
		expect(paymentCards()).toHaveLength(100);
		expect(screen.queryByText(/optimized view/)).toBeNull();
	});

	test('over 100 payments render only a window around the scroll position', () => {
		mount(monthlyEntries(120));
		expect(screen.getByText(/120 payments recorded/)).toBeTruthy();
		expect(screen.getByText(/optimized view/)).toBeTruthy();
		const cards = paymentCards();
		expect(cards.length).toBeLessThan(120);
		expect(within(cards[0]!).getByLabelText(/^Payment number/).textContent).toBe('#120');
	});

	test('scrolling moves the rendered window down the history', async () => {
		mount(monthlyEntries(120));
		const list = screen.getByRole('list', { name: 'Payment history timeline' });
		const scroller = list.parentElement!.parentElement!;
		scroller.scrollTop = 180 * 50;
		await fireEvent.scroll(scroller);
		const numbers = paymentCards().map(
			card => within(card).getByLabelText(/^Payment number/).textContent
		);
		expect(numbers[0]).toBe('#75');
		expect(numbers).not.toContain('#120');
		expect(list.getAttribute('style')).toContain(`translateY(${45 * 180}px)`);
	});
});
