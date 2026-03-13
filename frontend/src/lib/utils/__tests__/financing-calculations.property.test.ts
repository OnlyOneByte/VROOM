/**
 * Property-Based Tests for derivePaymentEntries()
 *
 * Property 4: Payment Number Monotonicity and Remaining Balance
 * Property 9: Payment Type Classification
 * Property 10: Principal and Interest Derivation
 */

import { describe, expect, test } from 'vitest';
import fc from 'fast-check';
import type { Expense, VehicleFinancing } from '$lib/types';
import {
	calculateAmortizationSchedule,
	derivePaymentEntries
} from '$lib/utils/financing-calculations';

// ---------------------------------------------------------------------------
// Helpers — build valid Expense and VehicleFinancing objects for testing
// ---------------------------------------------------------------------------

let expenseCounter = 0;

function makeExpense(amount: number, dateIndex: number): Expense {
	expenseCounter++;
	const month = String(((dateIndex - 1) % 12) + 1).padStart(2, '0');
	const year = 2024 + Math.floor((dateIndex - 1) / 12);
	const day = String(Math.min(dateIndex, 28)).padStart(2, '0');
	return {
		id: `exp-${expenseCounter}`,
		vehicleId: 'vehicle-1',
		userId: 'user-1',
		tags: [],
		category: 'financial',
		amount,
		date: `${year}-${month}-${day}`,
		isFinancingPayment: true,
		createdAt: '2024-01-01T00:00:00.000Z',
		updatedAt: '2024-01-01T00:00:00.000Z'
	};
}

function makeFinancing(overrides: Partial<VehicleFinancing> = {}): VehicleFinancing {
	return {
		id: 'fin-1',
		vehicleId: 'vehicle-1',
		financingType: 'loan',
		provider: 'Test Bank',
		originalAmount: 20000,
		currentBalance: 20000,
		apr: 5.0,
		termMonths: 60,
		startDate: '2024-01-01',
		paymentAmount: 400,
		paymentFrequency: 'monthly',
		isActive: true,
		createdAt: '2024-01-01T00:00:00.000Z',
		updatedAt: '2024-01-01T00:00:00.000Z',
		...overrides
	};
}

// ---------------------------------------------------------------------------
// Arbitraries — smart generators that constrain to valid input space
// ---------------------------------------------------------------------------

/** Positive amount rounded to 2 decimal places */
const arbAmount = fc
	.double({ min: 0.01, max: 50_000, noNaN: true, noDefaultInfinity: true })
	.map(v => Math.round(v * 100) / 100);

/** Array of 1–20 positive expense amounts */
const arbAmounts = fc.array(arbAmount, { minLength: 1, maxLength: 20 });

/** Original financing amount (reasonable range) */
const arbOriginalAmount = fc
	.double({ min: 100, max: 200_000, noNaN: true, noDefaultInfinity: true })
	.map(v => Math.round(v * 100) / 100);

/** Payment amount for the financing schedule */
const arbPaymentAmount = fc
	.double({ min: 50, max: 5_000, noNaN: true, noDefaultInfinity: true })
	.map(v => Math.round(v * 100) / 100);

/** APR for loans (0.1% to 30%) */
const arbApr = fc
	.double({ min: 0.1, max: 30, noNaN: true, noDefaultInfinity: true })
	.map(v => Math.round(v * 100) / 100);

/** Term months (6 to 84) */
const arbTermMonths = fc.integer({ min: 6, max: 84 });

// ---------------------------------------------------------------------------
// Property 4: Payment Number Monotonicity and Remaining Balance
//
// `paymentNumber` equals 1-based index, `remainingBalance` is non-increasing
// across sequential entries (assuming all payment amounts are positive).
//
// **Validates: Requirements 7.1, 7.2**
// ---------------------------------------------------------------------------
describe('Property 4: Payment Number Monotonicity and Remaining Balance', () => {
	test('paymentNumber equals 1-based index for all entries', () => {
		fc.assert(
			fc.property(
				arbOriginalAmount,
				arbPaymentAmount,
				arbAmounts,
				(originalAmount, paymentAmount, amounts) => {
					const expenses = amounts.map((a, i) => makeExpense(a, i + 1));
					const financing = makeFinancing({ originalAmount, paymentAmount });

					const entries = derivePaymentEntries(expenses, financing);

					for (let i = 0; i < entries.length; i++) {
						const entry = entries[i];
						expect(entry?.paymentNumber).toBe(i + 1);
					}
				}
			),
			{ numRuns: 200 }
		);
	});

	test('remainingBalance is non-increasing across sequential entries', () => {
		fc.assert(
			fc.property(
				arbOriginalAmount,
				arbPaymentAmount,
				arbAmounts,
				(originalAmount, paymentAmount, amounts) => {
					const expenses = amounts.map((a, i) => makeExpense(a, i + 1));
					const financing = makeFinancing({ originalAmount, paymentAmount });

					const entries = derivePaymentEntries(expenses, financing);

					for (let i = 1; i < entries.length; i++) {
						const current = entries[i];
						const previous = entries[i - 1];
						if (current && previous) {
							expect(current.remainingBalance).toBeLessThanOrEqual(previous.remainingBalance);
						}
					}
				}
			),
			{ numRuns: 200 }
		);
	});

	test('remainingBalance equals max(0, originalAmount - cumulativeSum)', () => {
		fc.assert(
			fc.property(
				arbOriginalAmount,
				arbPaymentAmount,
				arbAmounts,
				(originalAmount, paymentAmount, amounts) => {
					const expenses = amounts.map((a, i) => makeExpense(a, i + 1));
					const financing = makeFinancing({ originalAmount, paymentAmount });

					const entries = derivePaymentEntries(expenses, financing);

					let cumulativeSum = 0;
					for (const entry of entries) {
						cumulativeSum += entry.expense.amount;
						const expected = Math.max(0, originalAmount - cumulativeSum);
						expect(Math.abs(entry.remainingBalance - expected)).toBeLessThanOrEqual(0.01);
					}
				}
			),
			{ numRuns: 200 }
		);
	});

	test('result length equals input expenses length', () => {
		fc.assert(
			fc.property(
				arbOriginalAmount,
				arbPaymentAmount,
				arbAmounts,
				(originalAmount, paymentAmount, amounts) => {
					const expenses = amounts.map((a, i) => makeExpense(a, i + 1));
					const financing = makeFinancing({ originalAmount, paymentAmount });

					const entries = derivePaymentEntries(expenses, financing);

					expect(entries.length).toBe(expenses.length);
				}
			),
			{ numRuns: 200 }
		);
	});
});

// ---------------------------------------------------------------------------
// Property 9: Payment Type Classification
//
// `expenseAmount > paymentAmount` → 'extra'; otherwise → 'standard'
//
// **Validates: Requirement 7.5**
// ---------------------------------------------------------------------------
describe('Property 9: Payment Type Classification', () => {
	test('payment type is extra when expense amount exceeds financing paymentAmount, standard otherwise', () => {
		fc.assert(
			fc.property(
				arbOriginalAmount,
				arbPaymentAmount,
				arbAmounts,
				(originalAmount, paymentAmount, amounts) => {
					const expenses = amounts.map((a, i) => makeExpense(a, i + 1));
					const financing = makeFinancing({ originalAmount, paymentAmount });

					const entries = derivePaymentEntries(expenses, financing);

					for (const entry of entries) {
						const expectedType = entry.expense.amount > paymentAmount ? 'extra' : 'standard';
						expect(entry.paymentType).toBe(expectedType);
					}
				}
			),
			{ numRuns: 200 }
		);
	});

	test('payment exactly equal to paymentAmount is classified as standard', () => {
		fc.assert(
			fc.property(arbOriginalAmount, arbPaymentAmount, (originalAmount, paymentAmount) => {
				const expenses = [makeExpense(paymentAmount, 1)];
				const financing = makeFinancing({ originalAmount, paymentAmount });

				const entries = derivePaymentEntries(expenses, financing);

				expect(entries[0]?.paymentType).toBe('standard');
			}),
			{ numRuns: 200 }
		);
	});
});

// ---------------------------------------------------------------------------
// Property 10: Principal and Interest Derivation
//
// Loan with APR > 0: principalAmount and interestAmount match amortization
// schedule. Lease or no APR: principalAmount = expenseAmount, interestAmount = 0.
//
// **Validates: Requirements 7.3, 7.4**
// ---------------------------------------------------------------------------
describe('Property 10: Principal and Interest Derivation', () => {
	test('lease financing: principalAmount equals expense amount, interestAmount is 0', () => {
		fc.assert(
			fc.property(
				arbOriginalAmount,
				arbPaymentAmount,
				arbAmounts,
				(originalAmount, paymentAmount, amounts) => {
					const expenses = amounts.map((a, i) => makeExpense(a, i + 1));
					const financing = makeFinancing({
						originalAmount,
						paymentAmount,
						financingType: 'lease',
						apr: 3.0
					});

					const entries = derivePaymentEntries(expenses, financing);

					for (const entry of entries) {
						expect(entry.principalAmount).toBe(entry.expense.amount);
						expect(entry.interestAmount).toBe(0);
					}
				}
			),
			{ numRuns: 200 }
		);
	});

	test('loan with no APR (apr=0): principalAmount equals expense amount, interestAmount is 0', () => {
		fc.assert(
			fc.property(
				arbOriginalAmount,
				arbPaymentAmount,
				arbAmounts,
				(originalAmount, paymentAmount, amounts) => {
					const expenses = amounts.map((a, i) => makeExpense(a, i + 1));
					const financing = makeFinancing({
						originalAmount,
						paymentAmount,
						financingType: 'loan',
						apr: 0
					});

					const entries = derivePaymentEntries(expenses, financing);

					for (const entry of entries) {
						expect(entry.principalAmount).toBe(entry.expense.amount);
						expect(entry.interestAmount).toBe(0);
					}
				}
			),
			{ numRuns: 200 }
		);
	});

	test('loan with no APR (apr=undefined): principalAmount equals expense amount, interestAmount is 0', () => {
		fc.assert(
			fc.property(
				arbOriginalAmount,
				arbPaymentAmount,
				arbAmounts,
				(originalAmount, paymentAmount, amounts) => {
					const expenses = amounts.map((a, i) => makeExpense(a, i + 1));
					const financing = makeFinancing({
						originalAmount,
						paymentAmount,
						financingType: 'loan',
						apr: undefined
					});

					const entries = derivePaymentEntries(expenses, financing);

					for (const entry of entries) {
						expect(entry.principalAmount).toBe(entry.expense.amount);
						expect(entry.interestAmount).toBe(0);
					}
				}
			),
			{ numRuns: 200 }
		);
	});

	test('loan with APR > 0: principalAmount and interestAmount match amortization schedule values', () => {
		fc.assert(
			fc.property(
				arbOriginalAmount,
				arbPaymentAmount,
				arbApr,
				arbTermMonths,
				arbAmounts,
				(originalAmount, paymentAmount, apr, termMonths, amounts) => {
					// Ensure paymentAmount covers at least the first month's interest
					// so the amortization schedule produces valid entries
					const monthlyRate = apr / 100 / 12;
					const firstMonthInterest = originalAmount * monthlyRate;
					if (paymentAmount <= firstMonthInterest) return; // skip degenerate cases

					const expenses = amounts.map((a, i) => makeExpense(a, i + 1));
					const financing = makeFinancing({
						originalAmount,
						paymentAmount,
						financingType: 'loan',
						apr,
						termMonths
					});

					const entries = derivePaymentEntries(expenses, financing);

					// Use the same amortization schedule the function uses internally
					const schedule = calculateAmortizationSchedule(financing, expenses.length);

					for (let i = 0; i < entries.length; i++) {
						const entry = entries[i];
						const scheduleEntry = schedule[i];

						if (entry && scheduleEntry) {
							expect(entry.principalAmount).toBe(scheduleEntry.principalAmount);
							expect(entry.interestAmount).toBe(scheduleEntry.interestAmount);
						}
					}
				}
			),
			{ numRuns: 200 }
		);
	});
});
