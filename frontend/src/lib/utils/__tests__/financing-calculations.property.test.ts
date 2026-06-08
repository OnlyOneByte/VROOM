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
	calculateMinimumPayment,
	calculatePayoffDate,
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
		sourceType: 'financing' as const,
		sourceId: 'fin-test',
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
		computedBalance: 20000,
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
			{ numRuns: 100 }
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
			{ numRuns: 100 }
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
			{ numRuns: 100 }
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
			{ numRuns: 100 }
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
			{ numRuns: 100 }
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
			{ numRuns: 100 }
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
			{ numRuns: 100 }
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
			{ numRuns: 100 }
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
			{ numRuns: 100 }
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
			{ numRuns: 100 }
		);
	});
});

// ---------------------------------------------------------------------------
// calculateMinimumPayment — the standard amortization formula
//   M = P * [r(1+r)^n] / [(1+r)^n - 1]
// The 0%-APR / lease / missing-input paths return null, which is what keeps the
// (factor - 1) denominator from being a divide-by-zero (the cycle-168 class).
// These were untested; the property suite above only covers derivePaymentEntries.
// ---------------------------------------------------------------------------
describe('calculateMinimumPayment', () => {
	test('matches the closed-form amortization value for a known loan', () => {
		// 20,000 at 6% APR over 60 months. Hand-computed: r=0.005, factor=1.005^60,
		// M = 20000*0.005*factor/(factor-1) ≈ 386.66.
		const m = calculateMinimumPayment(
			makeFinancing({ originalAmount: 20_000, apr: 6, termMonths: 60 })
		);
		expect(m).not.toBeNull();
		expect(m as number).toBeCloseTo(386.66, 1);
	});

	test('returns null at 0% APR (no interest formula → avoids the factor-1=0 divide)', () => {
		expect(calculateMinimumPayment(makeFinancing({ apr: 0 }))).toBeNull();
		expect(calculateMinimumPayment(makeFinancing({ apr: undefined }))).toBeNull();
	});

	test('returns null for a lease, or with non-positive amount/term', () => {
		expect(calculateMinimumPayment(makeFinancing({ financingType: 'lease' }))).toBeNull();
		expect(calculateMinimumPayment(makeFinancing({ originalAmount: 0 }))).toBeNull();
		expect(calculateMinimumPayment(makeFinancing({ termMonths: 0 }))).toBeNull();
	});

	test('is always a positive finite number when it returns a value (no NaN/Infinity)', () => {
		fc.assert(
			fc.property(
				fc.double({ min: 100, max: 200_000, noNaN: true, noDefaultInfinity: true }),
				fc.double({ min: 0.1, max: 30, noNaN: true, noDefaultInfinity: true }),
				fc.integer({ min: 1, max: 120 }),
				(originalAmount, apr, termMonths) => {
					const m = calculateMinimumPayment(makeFinancing({ originalAmount, apr, termMonths }));
					if (m !== null) {
						expect(Number.isFinite(m)).toBe(true);
						expect(m).toBeGreaterThan(0);
					}
				}
			),
			{ numRuns: 200 }
		);
	});
});

// ---------------------------------------------------------------------------
// calculatePayoffDate — has a distinct 0%-APR branch (simple division) and a
// with-APR amortization loop guarded against a payment that doesn't cover
// interest. Both return a valid Date (never NaN-time / Invalid Date).
// ---------------------------------------------------------------------------
describe('calculatePayoffDate', () => {
	function isValidDate(d: Date): boolean {
		return d instanceof Date && !Number.isNaN(d.getTime());
	}

	test('0% APR: returns a valid future date from the simple balance/payment division', () => {
		const d = calculatePayoffDate(
			makeFinancing({ apr: 0, computedBalance: 12_000, paymentAmount: 500 })
		);
		expect(isValidDate(d)).toBe(true);
		expect(d.getTime()).toBeGreaterThan(Date.now());
	});

	test('with APR: returns a valid date for a normal amortizing loan', () => {
		const d = calculatePayoffDate(
			makeFinancing({ apr: 5, computedBalance: 10_000, paymentAmount: 400 })
		);
		expect(isValidDate(d)).toBe(true);
	});

	test('a paid-off balance (<= 0) returns a valid date (today), not Invalid Date', () => {
		const d = calculatePayoffDate(makeFinancing({ computedBalance: 0 }));
		expect(isValidDate(d)).toBe(true);
	});

	test('always returns a valid Date across random loan inputs (no Invalid Date)', () => {
		fc.assert(
			fc.property(
				fc.double({ min: 0, max: 30, noNaN: true, noDefaultInfinity: true }),
				fc.double({ min: 100, max: 100_000, noNaN: true, noDefaultInfinity: true }),
				fc.double({ min: 50, max: 5_000, noNaN: true, noDefaultInfinity: true }),
				(apr, computedBalance, paymentAmount) => {
					const d = calculatePayoffDate(
						makeFinancing({ apr, computedBalance, paymentAmount })
					);
					expect(isValidDate(d)).toBe(true);
				}
			),
			{ numRuns: 200 }
		);
	});
});
