import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { Expense, VehicleFinancing } from '#lib/types/index.ts';
import {
	calculateAmortizationSchedule,
	calculateDaysUntil,
	calculateExtraPaymentImpact,
	calculateLeaseMetrics,
	calculateLeaseOverage,
	calculateMinimumPayment,
	calculateNextPaymentDate,
	calculatePayoffDate,
	calculatePayoffDateFromStart,
	derivePaymentEntries,
	elapsedMonths,
	formatPaymentFrequency,
	leaseTotalMileageAllowance,
	resolveCurrentOdometer
} from '#lib/utils/financing-calculations.ts';

const NOW = new Date(2025, 5, 15, 12, 0, 0);
const DAY = 86_400_000;

function makeLoan(overrides: Partial<VehicleFinancing> = {}): VehicleFinancing {
	return {
		id: 'fin-calc',
		vehicleId: 'vehicle-calc',
		financingType: 'loan',
		provider: 'Calc Bank',
		originalAmount: 10_000,
		computedBalance: 10_000,
		apr: 6,
		termMonths: 24,
		startDate: '2025-01-10T12:00:00',
		paymentAmount: 450,
		paymentFrequency: 'monthly',
		isActive: true,
		createdAt: '2025-01-10T00:00:00.000Z',
		updatedAt: '2025-01-10T00:00:00.000Z',
		...overrides
	};
}

function makeLease(overrides: Partial<VehicleFinancing> = {}): VehicleFinancing {
	return makeLoan({
		financingType: 'lease',
		apr: undefined,
		startDate: '2024-06-15T12:00:00',
		termMonths: 36,
		mileageLimit: 12_000,
		excessMileageFee: 0.25,
		...overrides
	});
}

function makeExpense(id: string, date: string, amount: number): Expense {
	return {
		id,
		vehicleId: 'vehicle-calc',
		userId: 'user-calc',
		tags: [],
		category: 'financial',
		date,
		amount,
		createdAt: date,
		updatedAt: date
	};
}

function throwingPrimitive(): string {
	return {
		[Symbol.toPrimitive]() {
			throw new Error('cannot coerce');
		}
	} as unknown as string;
}

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(NOW);
	vi.spyOn(console, 'warn').mockImplementation(() => {});
	vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe('calculateAmortizationSchedule input guards', () => {
	test.each<[string, Partial<VehicleFinancing>]>([
		['lease financing', { financingType: 'lease' }],
		['missing apr', { apr: undefined }],
		['zero apr', { apr: 0 }],
		['zero originalAmount', { originalAmount: 0 }],
		['negative originalAmount', { originalAmount: -5 }],
		['zero paymentAmount', { paymentAmount: 0 }],
		['zero termMonths', { termMonths: 0 }],
		['empty startDate', { startDate: '' }],
		['unparseable startDate', { startDate: 'not-a-date' }]
	])('returns an empty schedule for %s', (_label, overrides) => {
		expect(calculateAmortizationSchedule(makeLoan(overrides))).toEqual([]);
	});

	test('returns an empty schedule when financing is null', () => {
		expect(calculateAmortizationSchedule(null as unknown as VehicleFinancing)).toEqual([]);
	});

	test('returns an empty schedule instead of throwing when the start date cannot be coerced', () => {
		expect(calculateAmortizationSchedule(makeLoan({ startDate: throwingPrimitive() }))).toEqual([]);
	});

	test('returns an empty schedule when the first payment does not cover the interest', () => {
		expect(
			calculateAmortizationSchedule(
				makeLoan({ originalAmount: 100_000, apr: 24, paymentAmount: 50 })
			)
		).toEqual([]);
	});
});

describe('calculateAmortizationSchedule schedule shape', () => {
	test('the first entry splits the payment into monthly interest and principal', () => {
		const [first] = calculateAmortizationSchedule(makeLoan({ originalAmount: 12_000 }));
		expect(first?.interestAmount).toBeCloseTo(60, 6);
		expect(first?.principalAmount).toBeCloseTo(390, 6);
		expect(first?.remainingBalance).toBeCloseTo(11_610, 6);
	});

	test('interest falls and principal rises as the balance amortizes', () => {
		const schedule = calculateAmortizationSchedule(makeLoan({ originalAmount: 8_000 }));
		expect(schedule[1]!.interestAmount).toBeLessThan(schedule[0]!.interestAmount);
		expect(schedule[1]!.principalAmount).toBeGreaterThan(schedule[0]!.principalAmount);
	});

	test('the final payment is capped at the remaining balance and ends at zero', () => {
		const schedule = calculateAmortizationSchedule(
			makeLoan({ originalAmount: 1_000, paymentAmount: 600, termMonths: 60 })
		);
		expect(schedule).toHaveLength(2);
		expect(schedule[0]?.remainingBalance).toBeCloseTo(405, 6);
		expect(schedule[1]?.principalAmount).toBeCloseTo(405, 6);
		expect(schedule[1]?.remainingBalance).toBe(0);
	});

	test('principal across a fully amortized schedule sums to the original amount', () => {
		const schedule = calculateAmortizationSchedule(
			makeLoan({ originalAmount: 20_000, apr: 6, termMonths: 60, paymentAmount: 386.66 })
		);
		const principal = schedule.reduce((sum, e) => sum + e.principalAmount, 0);
		expect(schedule).toHaveLength(60);
		expect(principal).toBeCloseTo(20_000 - schedule[59]!.remainingBalance, 6);
		expect(schedule[59]!.remainingBalance).toBeLessThan(1);
	});

	test('marks the first paidPaymentCount entries as paid', () => {
		const schedule = calculateAmortizationSchedule(makeLoan({ originalAmount: 9_000 }), 3);
		expect(schedule.slice(0, 3).every(e => e.isPaid)).toBe(true);
		expect(schedule[3]?.isPaid).toBe(false);
	});

	test('monthly payment dates clamp a 31st start to the end of shorter months', () => {
		const schedule = calculateAmortizationSchedule(
			makeLoan({ startDate: '2025-01-31T12:00:00', originalAmount: 2_000, paymentAmount: 100 })
		);
		expect(schedule[0]?.paymentDate.getMonth()).toBe(1);
		expect(schedule[0]?.paymentDate.getDate()).toBe(28);
		expect(schedule[2]?.paymentDate.getMonth()).toBe(3);
		expect(schedule[2]?.paymentDate.getDate()).toBe(30);
	});

	test('weekly payments are spaced seven days apart', () => {
		const schedule = calculateAmortizationSchedule(
			makeLoan({ paymentFrequency: 'weekly', originalAmount: 2_000, paymentAmount: 100 })
		);
		const gap = schedule[1]!.paymentDate.getTime() - schedule[0]!.paymentDate.getTime();
		expect(Math.round(gap / DAY)).toBe(7);
	});

	test('bi-weekly payments are spaced fourteen days apart', () => {
		const schedule = calculateAmortizationSchedule(
			makeLoan({ paymentFrequency: 'bi-weekly', originalAmount: 2_000, paymentAmount: 100 })
		);
		const gap = schedule[1]!.paymentDate.getTime() - schedule[0]!.paymentDate.getTime();
		expect(Math.round(gap / DAY)).toBe(14);
	});

	test('custom frequency falls back to monthly spacing', () => {
		const schedule = calculateAmortizationSchedule(
			makeLoan({ paymentFrequency: 'custom', originalAmount: 2_100, paymentAmount: 100 })
		);
		expect(schedule[0]?.paymentDate.getMonth()).toBe(1);
		expect(schedule[1]?.paymentDate.getMonth()).toBe(2);
		expect(schedule[0]?.paymentDate.getDate()).toBe(10);
	});
});

describe('calculateNextPaymentDate', () => {
	test('returns now for missing financing or start date', () => {
		expect(calculateNextPaymentDate(null as unknown as VehicleFinancing).getTime()).toBe(
			NOW.getTime()
		);
		expect(calculateNextPaymentDate(makeLoan({ startDate: '' })).getTime()).toBe(NOW.getTime());
	});

	test('returns now for an unparseable start date', () => {
		expect(calculateNextPaymentDate(makeLoan({ startDate: 'garbage' })).getTime()).toBe(
			NOW.getTime()
		);
	});

	test('after this month is paid the next monthly payment is a month after it', () => {
		const next = calculateNextPaymentDate(makeLoan(), new Date(2025, 5, 10, 12));
		expect(next.getFullYear()).toBe(2025);
		expect(next.getMonth()).toBe(6);
		expect(next.getDate()).toBe(10);
	});

	test('after this week is paid the next weekly payment is seven days after it', () => {
		const next = calculateNextPaymentDate(
			makeLoan({ paymentFrequency: 'weekly' }),
			new Date(2025, 5, 13, 12)
		);
		expect(next.getMonth()).toBe(5);
		expect(next.getDate()).toBe(20);
	});

	test('after this fortnight is paid the next bi-weekly payment is fourteen days after it', () => {
		const next = calculateNextPaymentDate(
			makeLoan({ paymentFrequency: 'bi-weekly' }),
			new Date(2025, 5, 13, 12)
		);
		expect(next.getMonth()).toBe(5);
		expect(next.getDate()).toBe(27);
	});

	test('returns now when the last payment date cannot be coerced', () => {
		const next = calculateNextPaymentDate(makeLoan(), throwingPrimitive() as unknown as Date);
		expect(next.getTime()).toBe(NOW.getTime());
	});
});

describe('calculatePayoffDate', () => {
	test('returns now for null financing', () => {
		expect(calculatePayoffDate(null as unknown as VehicleFinancing).getTime()).toBe(NOW.getTime());
	});

	test('returns now when the balance is already paid off', () => {
		expect(calculatePayoffDate(makeLoan({ computedBalance: 0 })).getTime()).toBe(NOW.getTime());
	});

	test('a missing balance is estimated from the original amount, not reported as paid off', () => {
		expect(calculatePayoffDate(makeLoan({ computedBalance: undefined }))).toEqual(
			calculatePayoffDate(makeLoan({ computedBalance: 10_000 }))
		);
	});

	test('returns now for a non-positive payment amount', () => {
		expect(calculatePayoffDate(makeLoan({ paymentAmount: 0 })).getTime()).toBe(NOW.getTime());
	});

	test('a lease pays off termMonths after its start date, clamped to month end', () => {
		const payoff = calculatePayoffDate(
			makeLoan({ financingType: 'lease', startDate: '2024-03-31T12:00:00', termMonths: 11 })
		);
		expect(payoff.getFullYear()).toBe(2025);
		expect(payoff.getMonth()).toBe(1);
		expect(payoff.getDate()).toBe(28);
	});

	test('a lease with an unparseable start date returns now', () => {
		expect(
			calculatePayoffDate(makeLoan({ financingType: 'lease', startDate: 'nope' })).getTime()
		).toBe(NOW.getTime());
	});

	test('a lease whose start date cannot be coerced returns now instead of throwing', () => {
		expect(
			calculatePayoffDate(
				makeLoan({ financingType: 'lease', startDate: throwingPrimitive() })
			).getTime()
		).toBe(NOW.getTime());
	});

	test('a zero-apr loan pays off after ceil(balance / payment) payments from today', () => {
		const payoff = calculatePayoffDate(
			makeLoan({ apr: 0, computedBalance: 1_001, paymentAmount: 100 })
		);
		expect(payoff.getFullYear()).toBe(2026);
		expect(payoff.getMonth()).toBe(4);
		expect(payoff.getDate()).toBe(15);
	});

	test('a zero-apr weekly loan counts payments in weeks', () => {
		const payoff = calculatePayoffDate(
			makeLoan({
				apr: undefined,
				computedBalance: 300,
				paymentAmount: 100,
				paymentFrequency: 'weekly'
			})
		);
		expect(Math.round((payoff.getTime() - NOW.getTime()) / DAY)).toBe(21);
	});

	test('a zero-apr bi-weekly loan counts payments in fortnights', () => {
		const payoff = calculatePayoffDate(
			makeLoan({ apr: 0, computedBalance: 250, paymentAmount: 100, paymentFrequency: 'bi-weekly' })
		);
		expect(Math.round((payoff.getTime() - NOW.getTime()) / DAY)).toBe(42);
	});

	test('an interest-bearing loan pays off after the simulated number of payments', () => {
		const payoff = calculatePayoffDate(
			makeLoan({ apr: 12, computedBalance: 1_000, paymentAmount: 510 })
		);
		expect(payoff.getMonth()).toBe(7);
		expect(payoff.getDate()).toBe(15);
	});

	test('interest lengthens the payoff compared with the same balance at zero apr', () => {
		const withInterest = calculatePayoffDate(
			makeLoan({ apr: 18, computedBalance: 5_000, paymentAmount: 500 })
		);
		const interestFree = calculatePayoffDate(
			makeLoan({ apr: 0, computedBalance: 5_000, paymentAmount: 500 })
		);
		expect(withInterest.getTime()).toBeGreaterThan(interestFree.getTime());
	});

	test('returns now when the payment does not cover monthly interest', () => {
		const payoff = calculatePayoffDate(
			makeLoan({ apr: 24, computedBalance: 100_000, paymentAmount: 100 })
		);
		expect(payoff.getTime()).toBe(NOW.getTime());
	});
});

describe('calculateExtraPaymentImpact', () => {
	test('null financing returns the inert default', () => {
		const impact = calculateExtraPaymentImpact(null as unknown as VehicleFinancing, 50);
		expect(impact).toMatchObject({
			extraPaymentAmount: 50,
			monthsSaved: 0,
			interestSaved: 0,
			totalSavings: 0
		});
	});

	test('a lease reports no savings and the lease end as its payoff date', () => {
		const impact = calculateExtraPaymentImpact(
			makeLoan({ financingType: 'lease', startDate: '2024-06-15T12:00:00', termMonths: 36 }),
			100
		);
		expect(impact.monthsSaved).toBe(0);
		expect(impact.newPayoffDate.getFullYear()).toBe(2027);
		expect(impact.newPayoffDate.getMonth()).toBe(5);
	});

	test('a zero or negative extra payment saves nothing', () => {
		const impact = calculateExtraPaymentImpact(makeLoan({ originalAmount: 10_001 }), 0);
		expect(impact.monthsSaved).toBe(0);
		expect(impact.interestSaved).toBe(0);
		const negative = calculateExtraPaymentImpact(makeLoan({ originalAmount: 10_002 }), -25);
		expect(negative.monthsSaved).toBe(0);
	});

	test('returns the inert default when the term cannot be coerced', () => {
		const impact = calculateExtraPaymentImpact(
			makeLoan({ termMonths: throwingPrimitive() as unknown as number }),
			100
		);
		expect(impact.monthsSaved).toBe(0);
		expect(impact.totalSavings).toBe(0);
	});

	test('an extra payment on an interest-bearing loan shortens the term and saves interest', () => {
		const impact = calculateExtraPaymentImpact(
			makeLoan({ computedBalance: 1_000, apr: 12, paymentAmount: 260 }),
			240
		);
		expect(impact.monthsSaved).toBe(1);
		expect(impact.interestSaved).toBeCloseTo(9.648_75, 6);
		expect(impact.totalSavings).toBe(impact.interestSaved);
		expect(impact.newPayoffDate.getMonth()).toBe(8);
		expect(impact.newPayoffDate.getDate()).toBe(15);
	});

	test('an extra payment on a zero-apr loan saves months but no interest', () => {
		const impact = calculateExtraPaymentImpact(
			makeLoan({ apr: 0, computedBalance: 1_200, paymentAmount: 100 }),
			100
		);
		expect(impact.monthsSaved).toBe(6);
		expect(impact.interestSaved).toBe(0);
	});
});

describe('lease mileage helpers', () => {
	test('the allowance scales the annual limit by the lease term in years', () => {
		expect(leaseTotalMileageAllowance(makeLease({ termMonths: 36, mileageLimit: 12_000 }))).toBe(
			36_000
		);
		expect(leaseTotalMileageAllowance(makeLease({ termMonths: 18, mileageLimit: 10_000 }))).toBe(
			15_000
		);
	});

	test('a zero-length term counts as one year and a missing limit as zero', () => {
		expect(leaseTotalMileageAllowance(makeLease({ termMonths: 0, mileageLimit: 12_000 }))).toBe(
			12_000
		);
		expect(leaseTotalMileageAllowance(makeLease({ mileageLimit: undefined }))).toBe(0);
	});

	test('overage charges the per-mile fee for miles beyond the term allowance', () => {
		expect(calculateLeaseOverage(makeLease(), 40_000)).toEqual({
			excessMiles: 4_000,
			overageCost: 1_000
		});
	});

	test('miles within the allowance incur no overage', () => {
		expect(calculateLeaseOverage(makeLease(), 36_000)).toEqual({ excessMiles: 0, overageCost: 0 });
	});

	test('a missing fee reports the excess miles at zero cost', () => {
		expect(calculateLeaseOverage(makeLease({ excessMileageFee: undefined }), 37_000)).toEqual({
			excessMiles: 1_000,
			overageCost: 0
		});
	});

	test('loans and leases without a mileage limit never report overage', () => {
		expect(calculateLeaseOverage(makeLoan({ mileageLimit: 12_000 }), 99_999)).toEqual({
			excessMiles: 0,
			overageCost: 0
		});
		expect(calculateLeaseOverage(makeLease({ mileageLimit: undefined }), 99_999)).toEqual({
			excessMiles: 0,
			overageCost: 0
		});
	});

	test('the current odometer wins over current mileage, which wins over the initial reading', () => {
		expect(resolveCurrentOdometer(30_000, 29_000, 10_000)).toBe(30_000);
		expect(resolveCurrentOdometer(null, 29_000, 10_000)).toBe(29_000);
		expect(resolveCurrentOdometer(undefined, null, 10_000)).toBe(10_000);
		expect(resolveCurrentOdometer(null, undefined, null)).toBeNull();
		expect(resolveCurrentOdometer(0, 29_000, 10_000)).toBe(0);
	});
});

describe('calculateLeaseMetrics', () => {
	test('returns null for null financing', () => {
		expect(calculateLeaseMetrics(null as unknown as VehicleFinancing, 100, 0)).toBeNull();
	});

	test('returns null for an unparseable endDate', () => {
		expect(calculateLeaseMetrics(makeLease({ endDate: 'never' }), 100, 0)).toBeNull();
	});

	test('returns null instead of throwing when the start date cannot be coerced', () => {
		expect(calculateLeaseMetrics(makeLease({ startDate: throwingPrimitive() }), 100, 0)).toBeNull();
	});

	test('an explicit endDate overrides the term-derived end', () => {
		const metrics = calculateLeaseMetrics(
			makeLease({
				startDate: '2025-06-01T12:00:00',
				endDate: '2025-06-25T12:00:00',
				termMonths: 36
			}),
			null,
			null
		);
		expect(metrics?.daysRemaining).toBe(10);
		expect(metrics?.monthsRemaining).toBe(1);
	});

	test('projects the current driving rate to flag over-mileage and price the overage', () => {
		const metrics = calculateLeaseMetrics(makeLease(), 25_000, 10_000);
		expect(metrics).not.toBeNull();
		expect(metrics!.daysRemaining).toBe(730);
		expect(metrics!.monthsRemaining).toBe(25);
		expect(metrics!.mileageUsed).toBe(15_000);
		expect(metrics!.mileageRemaining).toBe(21_000);
		expect(metrics!.projectedFinalMileage).toBeCloseTo(55_000, 6);
		expect(metrics!.projectedExcessMiles).toBeCloseTo(9_000, 6);
		expect(metrics!.projectedExcessFee).toBeCloseTo(2_250, 6);
		expect(metrics!.isOverMileage).toBe(true);
	});

	test('a driving rate that lands exactly on the allowance is not over-mileage', () => {
		const metrics = calculateLeaseMetrics(makeLease(), 22_000, 10_000);
		expect(metrics!.projectedExcessMiles).toBeCloseTo(0, 6);
		expect(metrics!.isOverMileage).toBe(false);
		expect(metrics!.projectedExcessFee).toBeCloseTo(0, 6);
	});

	test('miles already beyond the allowance leave none remaining', () => {
		const metrics = calculateLeaseMetrics(makeLease(), 50_000, 10_000);
		expect(metrics!.mileageUsed).toBe(40_000);
		expect(metrics!.mileageRemaining).toBe(0);
		expect(metrics!.isOverMileage).toBe(true);
	});

	test('a lease that has ended reports no days or months remaining', () => {
		const metrics = calculateLeaseMetrics(
			makeLease({ startDate: '2021-01-15T12:00:00', termMonths: 36 }),
			40_000,
			0
		);
		expect(metrics!.daysRemaining).toBe(0);
		expect(metrics!.monthsRemaining).toBe(0);
	});

	test('a lease that starts today projects no extra miles', () => {
		const metrics = calculateLeaseMetrics(
			makeLease({ startDate: '2025-06-15T12:00:00' }),
			10_500,
			10_000
		);
		expect(metrics!.mileageUsed).toBe(500);
		expect(metrics!.projectedFinalMileage).toBe(10_500);
		expect(metrics!.isOverMileage).toBe(false);
	});

	test('without a mileage limit usage is not tracked', () => {
		const metrics = calculateLeaseMetrics(makeLease({ mileageLimit: undefined }), 25_000, 10_000);
		expect(metrics!.mileageUsed).toBe(0);
		expect(metrics!.mileageRemaining).toBe(0);
		expect(metrics!.projectedFinalMileage).toBe(25_000);
		expect(metrics!.isOverMileage).toBe(false);
	});
});

describe('formatPaymentFrequency', () => {
	test.each([
		['monthly', 'Monthly'],
		['bi-weekly', 'Bi-weekly'],
		['weekly', 'Weekly'],
		['custom', 'Custom'],
		['quarterly', 'quarterly']
	])('formats %s as %s', (input, expected) => {
		expect(formatPaymentFrequency(input)).toBe(expected);
	});
});

describe('calculateDaysUntil', () => {
	test('rounds a partial day up', () => {
		expect(calculateDaysUntil(new Date(NOW.getTime() + 36 * 3_600_000))).toBe(2);
	});

	test('returns a negative count for past dates', () => {
		expect(calculateDaysUntil(new Date(NOW.getTime() - 3 * DAY))).toBe(-3);
	});
});

describe('calculateMinimumPayment', () => {
	test('returns the standard annuity payment rounded to cents', () => {
		expect(
			calculateMinimumPayment(makeLoan({ originalAmount: 20_000, apr: 6, termMonths: 60 }))
		).toBe(386.66);
	});

	test.each<[string, Partial<VehicleFinancing>]>([
		['a lease', { financingType: 'lease' }],
		['zero apr', { apr: 0 }],
		['missing apr', { apr: undefined }],
		['zero principal', { originalAmount: 0 }],
		['zero term', { termMonths: 0 }]
	])('returns null for %s', (_label, overrides) => {
		expect(calculateMinimumPayment(makeLoan(overrides))).toBeNull();
	});
});

describe('elapsedMonths', () => {
	test('returns zero when the date is on or before the start', () => {
		expect(elapsedMonths(new Date('2025-03-10'), new Date('2025-03-10'))).toBe(0);
		expect(elapsedMonths(new Date('2025-03-10'), new Date('2025-01-10'))).toBe(0);
	});

	test('counts whole calendar months exactly', () => {
		expect(elapsedMonths(new Date('2025-01-10'), new Date('2025-04-10'))).toBe(3);
	});

	test('adds the fraction of the current month that has elapsed', () => {
		expect(elapsedMonths(new Date('2025-01-10'), new Date('2025-02-24'))).toBeCloseTo(
			1 + 14 / 28,
			10
		);
	});

	test('a month-end start anchors to the clamped end of shorter months', () => {
		expect(elapsedMonths(new Date('2025-01-31'), new Date('2025-02-28'))).toBe(1);
		expect(elapsedMonths(new Date('2025-01-31'), new Date('2025-03-15'))).toBeCloseTo(
			1 + 15 / 31,
			10
		);
	});
});

const DATE_ONLY_START = '2025-01-10';

describe('derivePaymentEntries', () => {
	test('returns no entries when there are no payments', () => {
		expect(derivePaymentEntries([], makeLoan({ startDate: DATE_ONLY_START }))).toEqual([]);
	});

	test('sorts by date and tracks a running remaining balance', () => {
		const entries = derivePaymentEntries(
			[
				makeExpense('b', '2025-03-10', 300),
				makeExpense('a', '2025-02-10', 300),
				makeExpense('c', '2025-04-10', 500)
			],
			makeLoan({ startDate: DATE_ONLY_START, apr: 0, originalAmount: 1_000, paymentAmount: 300 })
		);
		expect(entries.map(e => e.expense.id)).toEqual(['a', 'b', 'c']);
		expect(entries.map(e => e.paymentNumber)).toEqual([1, 2, 3]);
		expect(entries.map(e => e.remainingBalance)).toEqual([700, 400, 0]);
	});

	test('without apr the whole payment is principal and over-payments are extra', () => {
		const entries = derivePaymentEntries(
			[makeExpense('a', '2025-02-10', 300), makeExpense('b', '2025-03-10', 450)],
			makeLoan({ startDate: DATE_ONLY_START, apr: 0, originalAmount: 2_000, paymentAmount: 300 })
		);
		expect(entries[0]).toMatchObject({
			principalAmount: 300,
			interestAmount: 0,
			paymentType: 'standard'
		});
		expect(entries[1]).toMatchObject({ principalAmount: 450, paymentType: 'extra' });
	});

	test('a lease never splits out interest even with an apr on file', () => {
		const entries = derivePaymentEntries(
			[makeExpense('a', '2025-02-10', 400)],
			makeLoan({
				startDate: DATE_ONLY_START,
				financingType: 'lease',
				apr: 5,
				originalAmount: 12_000,
				paymentAmount: 400
			})
		);
		expect(entries[0]).toMatchObject({
			interestAmount: 0,
			principalAmount: 400,
			remainingBalance: 11_600
		});
	});

	test('an unparseable start date disables interest rather than producing NaN', () => {
		const entries = derivePaymentEntries(
			[makeExpense('a', '2025-02-10', 400)],
			makeLoan({ startDate: 'garbage', originalAmount: 5_000, paymentAmount: 400 })
		);
		expect(entries[0]).toMatchObject({ interestAmount: 0, remainingBalance: 4_600 });
	});

	test('with apr the first payment carries one month of interest on the original amount', () => {
		const entries = derivePaymentEntries(
			[makeExpense('a', '2025-02-10', 450)],
			makeLoan({ startDate: DATE_ONLY_START, apr: 12, originalAmount: 10_000, paymentAmount: 450 })
		);
		expect(entries[0]?.interestAmount).toBe(100);
		expect(entries[0]?.principalAmount).toBe(350);
		expect(entries[0]?.remainingBalance).toBe(9_650);
	});

	test('a late first payment still only accrues one month of interest before it', () => {
		const entries = derivePaymentEntries(
			[makeExpense('a', '2025-05-10', 450)],
			makeLoan({ startDate: DATE_ONLY_START, apr: 12, originalAmount: 10_000, paymentAmount: 450 })
		);
		expect(entries[0]?.interestAmount).toBe(100);
		expect(entries[0]?.remainingBalance).toBe(9_650);
	});

	test('interest accrues on the reduced balance for each following month', () => {
		const entries = derivePaymentEntries(
			[makeExpense('a', '2025-02-10', 450), makeExpense('b', '2025-03-10', 450)],
			makeLoan({ startDate: DATE_ONLY_START, apr: 12, originalAmount: 10_000, paymentAmount: 450 })
		);
		expect(entries[1]?.interestAmount).toBe(96.5);
		expect(entries[1]?.principalAmount).toBe(353.5);
		expect(entries[1]?.remainingBalance).toBe(9_296.5);
	});

	test('a skipped month accrues two months of interest on the next payment', () => {
		const entries = derivePaymentEntries(
			[makeExpense('a', '2025-02-10', 450), makeExpense('b', '2025-04-10', 450)],
			makeLoan({ startDate: DATE_ONLY_START, apr: 12, originalAmount: 10_000, paymentAmount: 450 })
		);
		expect(entries[1]?.interestAmount).toBe(193);
		expect(entries[1]?.remainingBalance).toBe(9_393);
	});

	test('an extra payment is flagged and reduces the balance by more than a standard one', () => {
		const entries = derivePaymentEntries(
			[makeExpense('a', '2025-02-10', 450), makeExpense('b', '2025-03-10', 2_000)],
			makeLoan({ startDate: DATE_ONLY_START, apr: 12, originalAmount: 10_000, paymentAmount: 450 })
		);
		expect(entries[1]?.paymentType).toBe('extra');
		expect(entries[1]?.principalAmount).toBe(1_903.5);
		expect(entries[1]?.remainingBalance).toBe(7_746.5);
	});

	test('a payment smaller than the interest pays no principal and the balance grows', () => {
		const entries = derivePaymentEntries(
			[makeExpense('a', '2025-02-10', 50)],
			makeLoan({ startDate: DATE_ONLY_START, apr: 12, originalAmount: 10_000, paymentAmount: 450 })
		);
		expect(entries[0]).toMatchObject({ interestAmount: 50, principalAmount: 0 });
		expect(entries[0]?.remainingBalance).toBe(10_050);
	});

	test('the final payoff payment clears the balance and later payments accrue nothing', () => {
		const entries = derivePaymentEntries(
			[
				makeExpense('a', '2025-02-10', 600),
				makeExpense('b', '2025-03-10', 600),
				makeExpense('c', '2025-04-10', 600)
			],
			makeLoan({
				startDate: DATE_ONLY_START,
				apr: 6,
				originalAmount: 1_000,
				paymentAmount: 600,
				termMonths: 12
			})
		);
		expect(entries[0]).toMatchObject({ interestAmount: 5, remainingBalance: 405 });
		expect(entries[1]).toMatchObject({ interestAmount: 2.03, remainingBalance: 0 });
		expect(entries[2]).toMatchObject({
			interestAmount: 0,
			principalAmount: 600,
			remainingBalance: 0
		});
	});
});

describe('calculatePayoffDateFromStart', () => {
	test('a date-only start lands numPayments calendar months later', () => {
		const payoff = calculatePayoffDateFromStart('2025-01-15', 36);
		expect(payoff.getFullYear()).toBe(2028);
		expect(payoff.getMonth()).toBe(0);
		expect(payoff.getDate()).toBe(15);
	});

	test('a full ISO start is parsed as-is', () => {
		const payoff = calculatePayoffDateFromStart('2025-03-10T12:00:00', 2);
		expect(payoff.getMonth()).toBe(4);
		expect(payoff.getDate()).toBe(10);
	});

	test('a missing start counts from now', () => {
		const payoff = calculatePayoffDateFromStart(undefined, 1);
		expect(payoff.getMonth()).toBe(6);
		expect(payoff.getDate()).toBe(15);
	});
});
