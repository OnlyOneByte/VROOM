import { afterEach, describe, expect, test } from 'vitest';
import { cleanup, render, screen } from '@testing-library/svelte';
import LoanHero from '../LoanHero.svelte';
import { makeEntry, makeLoan } from './financing-fixtures.ts';

const PAYOFF = new Date(2029, 10, 15);

function mount(overrides: Partial<Parameters<typeof makeLoan>[0]> = {}, loaded = true) {
	const financing = makeLoan(overrides);
	const payments = [
		makeEntry({ paymentNumber: 1 }),
		makeEntry({ paymentNumber: 2 }),
		makeEntry({ paymentNumber: 3, paymentType: 'extra', principalAmount: 500, interestAmount: 0 })
	];
	return render(LoanHero, {
		financing,
		payments: loaded ? payments : [],
		paymentsLoaded: loaded,
		payoffDate: PAYOFF
	});
}

afterEach(() => cleanup());

describe('LoanHero', () => {
	test('leads with the balance left, then the payoff sentence and the paid / left split', () => {
		mount();

		expect(screen.getByText('Loan left to pay · Test Bank')).toBeInTheDocument();
		expect(document.querySelector('[data-slot="hero-figure"]')).toHaveTextContent('$15,000');
		const sentence = screen.getByTestId('loan-sentence');
		expect(sentence).toHaveTextContent(
			/^3 of 60 payments made\. At \$400\.00 a month it's paid off in Nov 2029, with \$[\d,]+ of interest still to go\.$/
		);
		expect(screen.getByRole('list')).toHaveTextContent(
			/Principal paid\s*\$1,100.*Interest paid\s*\$200.*Left to pay\s*\$15,000/
		);
	});

	test('without an APR it leaves out the interest still to go', () => {
		mount({ apr: undefined });

		expect(screen.getByTestId('loan-sentence')).toHaveTextContent(
			"3 of 60 payments made. At $400.00 a month it's paid off in Nov 2029."
		);
	});

	test('an extra or larger payment still counts as a payment made', () => {
		mount();

		expect(screen.getByTestId('loan-sentence')).toHaveTextContent(/^3 of 60 payments made/);
	});

	test('interest still to go follows the live balance at the monthly payment', () => {
		mount({ computedBalance: 1000, apr: 12, paymentAmount: 510 });

		expect(screen.getByTestId('loan-sentence')).toHaveTextContent(
			'with $15 of interest still to go.'
		);
	});

	test.each([
		['bi-weekly', '$400.00 every two weeks'],
		['custom', '$400.00 per payment']
	] as const)('names the period for a %s loan, with no interest estimate', (frequency, text) => {
		mount({ paymentFrequency: frequency });

		const sentence = screen.getByTestId('loan-sentence');
		expect(sentence).toHaveTextContent(text);
		expect(sentence).not.toHaveTextContent('interest still to go');
	});

	test('a loan with nothing left says it is paid off', () => {
		mount({ computedBalance: 0 });

		expect(screen.getByTestId('loan-sentence')).toHaveTextContent(
			'3 payments made. The loan is paid off.'
		);
	});

	test('when the payment history could not load, it skips the count, the interest and the split', () => {
		mount({}, false);

		expect(screen.getByTestId('loan-sentence')).toHaveTextContent(
			"At $400.00 a month it's paid off in Nov 2029."
		);
		expect(screen.getByTestId('loan-sentence')).not.toHaveTextContent('payments made');
		expect(screen.queryByRole('list')).toBeNull();
	});

	test('holds the sentence space while the payment history loads', () => {
		const financing = makeLoan();
		const { container } = render(LoanHero, {
			financing,
			payments: [],
			paymentsLoaded: false,
			paymentsLoading: true,
			payoffDate: PAYOFF
		});

		expect(screen.queryByTestId('loan-sentence')).toBeNull();
		expect(container.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(2);
		expect(screen.getByText('$15,000')).toBeInTheDocument();
	});
});
