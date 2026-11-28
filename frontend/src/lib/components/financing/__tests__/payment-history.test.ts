import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/svelte';
import type { DerivedPaymentEntry, VehicleFinancing } from '#lib/types/index.ts';
import { derivePaymentEntries } from '#lib/utils/financing-calculations.ts';
import { localNoon, makeEntry, makeExpense, makeLease, makeLoan } from './financing-fixtures';

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

function rows(): HTMLElement[] {
	return within(screen.getByRole('list', { name: 'Payment history' })).getAllByRole('listitem');
}

const text = (el: HTMLElement) => (el.textContent ?? '').replace(/\s+/g, ' ').trim();

function monthlyEntries(count: number): DerivedPaymentEntry[] {
	return Array.from({ length: count }, (_, i) =>
		makeEntry({ paymentNumber: i + 1, expense: { id: `e${i + 1}`, date: localNoon(2015, i, 10) } })
	);
}

afterEach(() => {
	cleanup();
	store.currencyUnit = 'USD';
});

describe('Payment history', () => {
	test('with no payments it says so in one line, and lists nothing', () => {
		mount([]);
		expect(screen.getByRole('status').textContent).toMatch(/No payments recorded yet/);
		expect(screen.queryByRole('list')).toBeNull();
	});

	test('lists payments newest first with a recorded count', () => {
		mount([
			makeEntry({ paymentNumber: 1, expense: { id: 'a', date: localNoon(2025, 1, 10) } }),
			makeEntry({ paymentNumber: 3, expense: { id: 'c', date: localNoon(2025, 3, 10) } }),
			makeEntry({ paymentNumber: 2, expense: { id: 'b', date: localNoon(2025, 2, 10) } })
		]);
		expect(screen.getByText('3 payments recorded')).toBeTruthy();
		expect(rows().map(r => within(r).getByLabelText(/^Payment number/).textContent)).toEqual([
			'#3',
			'#2',
			'#1'
		]);
		expect(screen.getByLabelText('Payment 3 on Apr 10, 2025')).toBeTruthy();
	});

	test('one row per payment: number, date, split, amount and what was left', () => {
		mount([makeEntry({ remainingBalance: 19_700, principalAmount: 300, interestAmount: 100 })]);
		expect(screen.getByText('1 payment recorded')).toBeTruthy();
		const row = rows()[0]!;
		expect(text(row)).toBe(
			'#1 · Feb 10, 2025 $300.00 principal · $100.00 interest $400.00 $19,700.00 left'
		);
		expect(within(row).getByText('Feb 10, 2025').getAttribute('datetime')).toBe(
			localNoon(2025, 1, 10)
		);
	});

	test.each<[string, VehicleFinancing]>([
		['a zero-APR loan', makeLoan({ apr: 0 })],
		['a lease', makeLease()]
	])('%s shows no principal and interest split', (_label, financing) => {
		mount([makeEntry()], financing);
		expect(screen.queryByRole('group', { name: 'Payment breakdown' })).toBeNull();
	});

	test('an extra payment says so; a standard one carries no label', () => {
		mount([
			makeEntry({ paymentType: 'extra', expense: { id: 'x', date: localNoon(2025, 2, 10) } }),
			makeEntry({ paymentType: 'standard', expense: { id: 's' } })
		]);
		const [extra, standard] = rows();
		expect(within(extra!).getByText('Extra payment')).toBeTruthy();
		expect(within(standard!).queryByText(/Extra|Standard/)).toBeNull();
	});

	test('formats amounts in the user currency', () => {
		store.currencyUnit = 'EUR';
		mount([makeEntry({ remainingBalance: 19_700 })]);
		expect(screen.getByLabelText('Payment amount').textContent?.trim()).toBe('€400.00');
		expect(screen.getByText('€19,700.00')).toBeTruthy();
		expect(screen.queryByText(/\$/)).toBeNull();
	});

	test('renders the interest split and balances derived from real payments', () => {
		const financing = makeLoan({ apr: 12, originalAmount: 10_000, paymentAmount: 450 });
		const entries = derivePaymentEntries(
			[
				makeExpense({ id: 'p1', date: localNoon(2025, 1, 10), amount: 450 }),
				makeExpense({ id: 'p2', date: localNoon(2025, 2, 10), amount: 2_000 })
			],
			financing
		);
		mount(entries, financing);
		const [latest, first] = rows();
		expect(text(latest!)).toBe(
			'#2 · Mar 10, 2025 Extra payment $1,903.50 principal · $96.50 interest $2,000.00 $7,746.50 left'
		);
		expect(text(first!)).toBe(
			'#1 · Feb 10, 2025 $350.00 principal · $100.00 interest $450.00 $9,650.00 left'
		);
	});
});

describe('Payment history length', () => {
	test('shows the latest 6 in the page, with no scroll box, and "Show all" lists the rest', async () => {
		const { container } = mount(monthlyEntries(24));
		expect(rows()).toHaveLength(6);
		expect(within(rows()[0]!).getByLabelText(/^Payment number/).textContent).toBe('#24');
		expect(
			container.querySelector('[class*="overflow-y-auto"], [data-slot="scroll-area"]')
		).toBeNull();
		await fireEvent.click(screen.getByRole('button', { name: 'Show all 24' }));
		expect(rows()).toHaveLength(24);
		await fireEvent.click(screen.getByRole('button', { name: 'Show fewer' }));
		expect(rows()).toHaveLength(6);
	});

	test('6 or fewer payments show with no toggle', () => {
		mount(monthlyEntries(6));
		expect(rows()).toHaveLength(6);
		expect(screen.queryByRole('button')).toBeNull();
	});
});
