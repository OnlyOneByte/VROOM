import { describe, expect, test } from 'vitest';
import fc from 'fast-check';
import type { Expense, VehicleFinancing } from '#lib/types/index.ts';
import {
	calculateAmortizationSchedule,
	calculateMinimumPayment,
	calculatePayoffDate,
	derivePaymentEntries,
	elapsedMonths
} from '#lib/utils/financing-calculations.ts';

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

const arbAmount = fc
	.double({ min: 0.01, max: 50_000, noNaN: true, noDefaultInfinity: true })
	.map(v => Math.round(v * 100) / 100);

const arbAmounts = fc.array(arbAmount, { minLength: 1, maxLength: 20 });

const arbOriginalAmount = fc
	.double({ min: 100, max: 200_000, noNaN: true, noDefaultInfinity: true })
	.map(v => Math.round(v * 100) / 100);

const arbPaymentAmount = fc
	.double({ min: 50, max: 5_000, noNaN: true, noDefaultInfinity: true })
	.map(v => Math.round(v * 100) / 100);

const arbApr = fc
	.double({ min: 0.1, max: 30, noNaN: true, noDefaultInfinity: true })
	.map(v => Math.round(v * 100) / 100);

const arbTermMonths = fc.integer({ min: 6, max: 84 });

describe('Payment Number Monotonicity and Remaining Balance', () => {
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

	test('remainingBalance is non-increasing across sequential entries of a zero-interest loan', () => {
		fc.assert(
			fc.property(
				arbOriginalAmount,
				arbPaymentAmount,
				arbAmounts,
				(originalAmount, paymentAmount, amounts) => {
					const expenses = amounts.map((a, i) => makeExpense(a, i + 1));
					const financing = makeFinancing({ originalAmount, paymentAmount, apr: 0 });

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

	test('zero-interest loan: remainingBalance equals max(0, originalAmount - cumulativeSum)', () => {
		fc.assert(
			fc.property(
				arbOriginalAmount,
				arbPaymentAmount,
				arbAmounts,
				(originalAmount, paymentAmount, amounts) => {
					const expenses = amounts.map((a, i) => makeExpense(a, i + 1));
					const financing = makeFinancing({ originalAmount, paymentAmount, apr: 0 });

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

describe('Payment Type Classification', () => {
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

describe('Principal and Interest Derivation', () => {
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

	test('loan with APR > 0: on-schedule payments reconcile with the amortization schedule', () => {
		fc.assert(
			fc.property(
				arbOriginalAmount,
				arbApr,
				arbTermMonths,
				fc.integer({ min: 1, max: 24 }),
				(originalAmount, apr, termMonths, count) => {
					const paymentAmount = calculateMinimumPayment(
						makeFinancing({ originalAmount, apr, termMonths })
					);
					if (paymentAmount === null) return;
					const financing = makeFinancing({
						originalAmount,
						paymentAmount,
						financingType: 'loan',
						apr,
						termMonths
					});
					const expenses = scheduledPayments(Math.min(count, termMonths - 1), paymentAmount);

					const entries = derivePaymentEntries(expenses, financing);
					const schedule = calculateAmortizationSchedule(financing, expenses.length);

					entries.forEach((entry, i) => {
						const scheduleEntry = schedule[i];
						if (!scheduleEntry) return;
						const tolerance = 0.01 * (i + 1);
						expect(
							Math.abs(entry.interestAmount - scheduleEntry.interestAmount)
						).toBeLessThanOrEqual(tolerance);
						expect(
							Math.abs(entry.principalAmount - scheduleEntry.principalAmount)
						).toBeLessThanOrEqual(tolerance);
						expect(
							Math.abs(entry.remainingBalance - scheduleEntry.remainingBalance)
						).toBeLessThanOrEqual(tolerance);
					});
				}
			),
			{ numRuns: 100 }
		);
	});

	test('a payment logged BEYOND the amortization schedule is all-principal, zero-interest, balance floored at 0', () => {
		const financing = makeFinancing({
			originalAmount: 1000,
			apr: 12,
			termMonths: 6,
			paymentAmount: 200,
			financingType: 'loan'
		});
		const expenses = Array.from({ length: 8 }, (_, i) => makeExpense(200, i + 1));

		const entries = derivePaymentEntries(expenses, financing);
		const schedule = calculateAmortizationSchedule(financing, expenses.length);

		expect(schedule.length).toBeLessThan(entries.length);

		const beyond = entries.slice(schedule.length);
		expect(beyond.length).toBeGreaterThan(0);
		for (const entry of beyond) {
			expect(entry.interestAmount).toBe(0);
			expect(entry.principalAmount).toBe(entry.expense.amount);
			expect(entry.remainingBalance).toBe(0);
		}
	});
});

function scheduledPayments(count: number, amount: number): Expense[] {
	return Array.from({ length: count }, (_, i) => ({
		...makeExpense(amount, 1),
		date: new Date(Date.UTC(2024, i + 1, 1, 12)).toISOString()
	}));
}

describe('amortized remaining balance', () => {
	const loan = makeFinancing({
		originalAmount: 30_000,
		apr: 6,
		termMonths: 60,
		paymentAmount: 579.98,
		startDate: '2024-01-01'
	});

	test('matches the $30,000 / 6% / 60-month amortization table', () => {
		const at = (n: number) => derivePaymentEntries(scheduledPayments(n, 579.98), loan).at(-1);
		expect(at(1)).toMatchObject({ interestAmount: 150, principalAmount: 429.98 });
		expect(at(1)?.remainingBalance).toBe(29_570.02);
		expect(at(30)?.remainingBalance).toBe(16_120.25);
		expect(at(52)?.remainingBalance).toBe(4_537.43);
	});

	test('principal plus interest equals each payment', () => {
		for (const entry of derivePaymentEntries(scheduledPayments(36, 650), loan)) {
			expect(entry.principalAmount + entry.interestAmount).toBeCloseTo(entry.expense.amount, 2);
		}
	});

	test('a lump-sum extra payment on a payment date is all principal', () => {
		const regular = scheduledPayments(12, 579.98);
		const lump = { ...makeExpense(1_000, 1), date: regular[11]!.date };
		const entries = derivePaymentEntries([...regular, lump], loan);
		const last = entries.at(-1)!;
		expect(last.interestAmount).toBe(0);
		expect(last.principalAmount).toBe(1_000);
		expect(last.remainingBalance).toBeCloseTo(entries.at(-2)!.remainingBalance - 1_000, 2);
	});

	test('a recurring extra payment pays the loan down faster than the table', () => {
		const regular = derivePaymentEntries(scheduledPayments(24, 579.98), loan).at(-1)!;
		const extra = derivePaymentEntries(scheduledPayments(24, 679.98), loan).at(-1)!;
		expect(regular.remainingBalance - extra.remainingBalance).toBeGreaterThan(2_400);
		expect(extra.paymentType).toBe('extra');
	});

	test('zero-interest loan: balance is original minus payments', () => {
		const zero = makeFinancing({ originalAmount: 12_000, apr: 0, paymentAmount: 1_000 });
		const entries = derivePaymentEntries(scheduledPayments(10, 1_000), zero);
		expect(entries.at(-1)?.remainingBalance).toBe(2_000);
		expect(entries.every(e => e.interestAmount === 0)).toBe(true);
	});

	test('a loan added years after its start accrues interest from one month before the first logged payment', () => {
		const late = makeFinancing({
			originalAmount: 20_000,
			apr: 4.5,
			paymentAmount: 372.86,
			startDate: '2020-03-15'
		});
		const entry = derivePaymentEntries(
			[{ ...makeExpense(372.86, 1), date: '2026-11-15T12:00:00.000Z' }],
			late
		)[0]!;
		expect(entry.interestAmount).toBe(75);
		expect(entry.remainingBalance).toBe(19_702.14);
	});

	test('a payment smaller than the interest grows the balance and is all interest', () => {
		const entry = derivePaymentEntries(scheduledPayments(1, 100), loan)[0]!;
		expect(entry.interestAmount).toBe(100);
		expect(entry.principalAmount).toBe(0);
		expect(entry.remainingBalance).toBe(30_050);
	});
});

describe('elapsedMonths', () => {
	test('counts whole calendar months and day-fractions, clamping month ends', () => {
		expect(elapsedMonths(new Date('2024-01-15'), new Date('2024-03-15'))).toBe(2);
		expect(elapsedMonths(new Date('2024-01-31'), new Date('2024-02-29'))).toBe(1);
		expect(elapsedMonths(new Date('2024-01-15'), new Date('2024-01-30'))).toBeCloseTo(15 / 31);
		expect(elapsedMonths(new Date('2024-01-15'), new Date('2023-12-01'))).toBe(0);
	});
});

describe('calculateMinimumPayment', () => {
	test('matches the closed-form amortization value for a known loan', () => {
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
					const d = calculatePayoffDate(makeFinancing({ apr, computedBalance, paymentAmount }));
					expect(isValidDate(d)).toBe(true);
				}
			),
			{ numRuns: 200 }
		);
	});
});
