import type { DerivedPaymentEntry, Expense, VehicleFinancing } from '$lib/types';
import { memoizeMulti } from './memoize';

/**
 * Represents a single entry in an amortization schedule
 */
export interface AmortizationEntry {
	paymentNumber: number;
	paymentDate: Date;
	paymentAmount: number;
	principalAmount: number;
	interestAmount: number;
	remainingBalance: number;
	isPaid: boolean;
}

/**
 * Metrics for lease financing
 */
export interface LeaseMetrics {
	monthsRemaining: number;
	daysRemaining: number;
	mileageUsed: number;
	mileageRemaining: number;
	projectedFinalMileage: number;
	projectedExcessMiles: number;
	projectedExcessFee: number;
	isOverMileage: boolean;
}

/**
 * Result of extra payment impact calculation
 */
export interface ExtraPaymentImpact {
	extraPaymentAmount: number;
	newPayoffDate: Date;
	monthsSaved: number;
	interestSaved: number;
	totalSavings: number;
}

const DEV = import.meta.env.DEV;

function calculateAmortizationScheduleImpl(
	financing: VehicleFinancing,
	paidPaymentCount = 0
): AmortizationEntry[] {
	try {
		if (!financing) {
			if (DEV) console.warn('calculateAmortizationSchedule: financing is null or undefined');
			return [];
		}

		if (financing.financingType !== 'loan' || !financing.apr || financing.apr <= 0) {
			return [];
		}

		if (!financing.originalAmount || financing.originalAmount <= 0) {
			if (DEV) console.warn('calculateAmortizationSchedule: invalid originalAmount');
			return [];
		}

		if (!financing.paymentAmount || financing.paymentAmount <= 0) {
			if (DEV) console.warn('calculateAmortizationSchedule: invalid paymentAmount');
			return [];
		}

		if (!financing.termMonths || financing.termMonths <= 0) {
			if (DEV) console.warn('calculateAmortizationSchedule: invalid termMonths');
			return [];
		}

		if (!financing.startDate) {
			if (DEV) console.warn('calculateAmortizationSchedule: missing startDate');
			return [];
		}

		const schedule: AmortizationEntry[] = [];
		const monthlyRate = financing.apr / 100 / 12;
		const totalPayments = financing.termMonths;
		let remainingBalance = financing.originalAmount;
		const startDate = new Date(financing.startDate);

		if (isNaN(startDate.getTime())) {
			if (DEV) console.warn('calculateAmortizationSchedule: invalid startDate');
			return [];
		}

		for (let i = 1; i <= totalPayments; i++) {
			const interestAmount = remainingBalance * monthlyRate;
			const principalAmount = Math.min(financing.paymentAmount - interestAmount, remainingBalance);

			// Negative-amortization guard (C161): if the payment doesn't cover the period's interest,
			// principalAmount is negative and `remainingBalance - principalAmount` would GROW the balance
			// every period — emitting rows with negative principal + a climbing balance into the displayed
			// amortization table (and into derivePaymentEntries' totalPrincipalPaid/totalInterestPaid).
			// Stop the schedule, mirroring the sibling guards in calculatePayoffDate (:238) and
			// calculateExtraPaymentImpact (:311). The loan never amortizes under this payment, so there's
			// no meaningful further schedule to project.
			if (principalAmount <= 0) {
				if (DEV) console.warn('calculateAmortizationSchedule: payment does not cover interest');
				break;
			}

			remainingBalance = Math.max(0, remainingBalance - principalAmount);
			const paymentDate = calculatePaymentDate(startDate, i, financing.paymentFrequency);

			schedule.push({
				paymentNumber: i,
				paymentDate,
				paymentAmount: financing.paymentAmount,
				principalAmount,
				interestAmount,
				remainingBalance,
				isPaid: i <= paidPaymentCount
			});

			if (remainingBalance === 0) break;
		}

		return schedule;
	} catch (error) {
		if (DEV) console.error('Error calculating amortization schedule:', error);
		return [];
	}
}

function calculatePaymentDate(startDate: Date, paymentNumber: number, frequency: string): Date {
	try {
		const date = new Date(startDate);

		if (isNaN(date.getTime())) {
			if (DEV) console.warn('calculatePaymentDate: invalid startDate, using current date');
			return new Date();
		}

		switch (frequency) {
			case 'monthly':
				date.setMonth(date.getMonth() + paymentNumber);
				break;
			case 'bi-weekly':
				date.setDate(date.getDate() + paymentNumber * 14);
				break;
			case 'weekly':
				date.setDate(date.getDate() + paymentNumber * 7);
				break;
			default:
				date.setMonth(date.getMonth() + paymentNumber);
		}

		return date;
	} catch (error) {
		if (DEV) console.error('Error calculating payment date:', error);
		return new Date();
	}
}

export function calculateNextPaymentDate(
	financing: VehicleFinancing,
	lastPaymentDate?: Date
): Date {
	try {
		if (!financing || !financing.startDate) {
			if (DEV) console.warn('calculateNextPaymentDate: invalid financing data');
			return new Date();
		}

		const baseDate = lastPaymentDate || new Date(financing.startDate);
		const today = new Date();
		const nextDate = new Date(baseDate);

		if (isNaN(nextDate.getTime())) {
			if (DEV) console.warn('calculateNextPaymentDate: invalid base date');
			return new Date();
		}

		let iterations = 0;
		const maxIterations = 1000;

		while (nextDate <= today && iterations < maxIterations) {
			switch (financing.paymentFrequency) {
				case 'monthly':
					nextDate.setMonth(nextDate.getMonth() + 1);
					break;
				case 'bi-weekly':
					nextDate.setDate(nextDate.getDate() + 14);
					break;
				case 'weekly':
					nextDate.setDate(nextDate.getDate() + 7);
					break;
				default:
					nextDate.setMonth(nextDate.getMonth() + 1);
			}
			iterations++;
		}

		if (iterations >= maxIterations) {
			if (DEV) console.warn('calculateNextPaymentDate: max iterations reached');
			return new Date();
		}

		return nextDate;
	} catch (error) {
		if (DEV) console.error('Error calculating next payment date:', error);
		return new Date();
	}
}

export function calculatePayoffDate(financing: VehicleFinancing): Date {
	try {
		if (!financing) {
			if (DEV) console.warn('calculatePayoffDate: financing is null or undefined');
			return new Date();
		}

		if ((financing.computedBalance ?? 0) <= 0) {
			return new Date();
		}

		if (!financing.paymentAmount || financing.paymentAmount <= 0) {
			if (DEV) console.warn('calculatePayoffDate: invalid paymentAmount');
			return new Date();
		}

		if (financing.financingType === 'lease') {
			// Leases have a fixed end date based on start + term
			const startDate = new Date(financing.startDate);
			if (!isNaN(startDate.getTime())) {
				const endDate = new Date(startDate);
				endDate.setMonth(endDate.getMonth() + financing.termMonths);
				return endDate;
			}
			return new Date();
		}

		if (!financing.apr || financing.apr <= 0) {
			const paymentsRemaining = Math.ceil(
				(financing.computedBalance ?? 0) / financing.paymentAmount
			);
			return calculatePaymentDate(new Date(), paymentsRemaining, financing.paymentFrequency);
		}

		const monthlyRate = financing.apr / 100 / 12;
		let balance = financing.computedBalance ?? 0;
		let paymentsRemaining = 0;

		while (balance > 0 && paymentsRemaining < financing.termMonths * 2) {
			const interestAmount = balance * monthlyRate;
			const principalAmount = Math.min(financing.paymentAmount - interestAmount, balance);

			if (principalAmount <= 0) {
				if (DEV) console.warn('calculatePayoffDate: payment does not cover interest');
				return new Date();
			}

			balance -= principalAmount;
			paymentsRemaining++;
		}

		return calculatePaymentDate(new Date(), paymentsRemaining, financing.paymentFrequency);
	} catch (error) {
		if (DEV) console.error('Error calculating payoff date:', error);
		return new Date();
	}
}

export const calculateAmortizationSchedule = memoizeMulti(calculateAmortizationScheduleImpl);

/**
 * Walk a loan balance down month-by-month at a fixed payment, returning the number of months to
 * pay it off and the total interest paid. Stops at `maxMonths` (the runaway guard) or when a
 * payment no longer covers the period's interest (the negative-amortization guard — principal ≤ 0,
 * the same break the displayed schedule uses; C161 records that a hand-copied loop once LOST this
 * guard, which is exactly why this is now ONE function). Pure; `monthlyRate` 0 ⇒ interest 0 ⇒ the
 * full payment retires principal (the 0%-APR path, #92). Extracted C299 — `calculateExtraPaymentImpact`
 * ran this identical loop twice (original vs. extra payment), the only difference being the payment.
 */
function simulateAmortization(
	balance: number,
	monthlyRate: number,
	paymentAmount: number,
	maxMonths: number
): { months: number; totalInterest: number } {
	let months = 0;
	let totalInterest = 0;
	while (balance > 0 && months < maxMonths) {
		const interestAmount = balance * monthlyRate;
		const principalAmount = Math.min(paymentAmount - interestAmount, balance);
		if (principalAmount <= 0) break;
		balance -= principalAmount;
		totalInterest += interestAmount;
		months++;
	}
	return { months, totalInterest };
}

function calculateExtraPaymentImpactImpl(
	financing: VehicleFinancing,
	extraPaymentAmount: number
): ExtraPaymentImpact {
	const defaultResult: ExtraPaymentImpact = {
		extraPaymentAmount,
		newPayoffDate: new Date(),
		monthsSaved: 0,
		interestSaved: 0,
		totalSavings: 0
	};

	try {
		if (!financing) {
			if (DEV) console.warn('calculateExtraPaymentImpact: financing is null or undefined');
			return defaultResult;
		}

		// Only NON-loans (lease/own) have no amortization to accelerate. A 0%-APR (or no-APR-entered)
		// loan is interest-free but NOT inert: extra payments still retire the principal faster, so they
		// genuinely shorten the term (monthsSaved > 0) even though interestSaved is $0. The old guard
		// `!financing.apr || financing.apr <= 0` lumped every 0%-APR loan in with leases and returned a
		// flat monthsSaved:0, so the PaymentPlannerDialog showed "0 mos" for an interest-free loan where
		// an extra payment clearly shortens the payoff (#92). The amortization loop below already handles
		// 0% correctly — monthlyRate 0 → interest 0 → the full payment goes to principal each month — so
		// the fix is simply to let 0%-APR loans through and compute the rate as 0.
		if (financing.financingType !== 'loan') {
			return { ...defaultResult, newPayoffDate: calculatePayoffDate(financing) };
		}

		if (extraPaymentAmount <= 0) {
			return { ...defaultResult, newPayoffDate: calculatePayoffDate(financing) };
		}

		const monthlyRate = financing.apr && financing.apr > 0 ? financing.apr / 100 / 12 : 0;
		const newPaymentAmount = financing.paymentAmount + extraPaymentAmount;
		const balance = financing.computedBalance ?? 0;
		const maxMonths = financing.termMonths * 2;

		// Same amortization walk at two payment levels (the only difference): original schedule vs. the
		// accelerated one with the extra payment. The savings are the deltas. See simulateAmortization.
		const original = simulateAmortization(balance, monthlyRate, financing.paymentAmount, maxMonths);
		const accelerated = simulateAmortization(balance, monthlyRate, newPaymentAmount, maxMonths);

		const monthsSaved = Math.max(0, original.months - accelerated.months);
		const interestSaved = Math.max(0, original.totalInterest - accelerated.totalInterest);
		const newPayoffDate = calculatePaymentDate(
			new Date(),
			accelerated.months,
			financing.paymentFrequency
		);

		return {
			extraPaymentAmount,
			newPayoffDate,
			monthsSaved,
			interestSaved,
			totalSavings: interestSaved
		};
	} catch (error) {
		if (DEV) console.error('Error calculating extra payment impact:', error);
		return defaultResult;
	}
}

export const calculateExtraPaymentImpact = memoizeMulti(calculateExtraPaymentImpactImpl);

/**
 * Resolve the odometer reading to use for lease overage / loan miles-used (C157, bug #lease-loan,
 * Angelo-approved C151). Miles-used is inherently ALL-TIME, so it must prefer the canonical all-sources,
 * period-independent `currentOdometer` (GET /stats, C52) over the period-scoped + fuel-only
 * `currentMileage` (which shrinks under a 7d/30d stats window and ignores manual odometer entries).
 * Falls back currentOdometer → currentMileage → initialMileage → null. Pure + host-independent so both
 * FinanceTab call sites (PaymentMetricsGrid mileageUsed, LeaseMetricsCard) derive miles identically.
 */
export function resolveCurrentOdometer(
	currentOdometer: number | null | undefined,
	currentMileage: number | null | undefined,
	initialMileage: number | null | undefined
): number | null {
	return currentOdometer ?? currentMileage ?? initialMileage ?? null;
}

export function calculateLeaseMetrics(
	financing: VehicleFinancing,
	currentMileage: number | null,
	initialMileage: number | null
): LeaseMetrics | null {
	try {
		if (!financing) {
			if (DEV) console.warn('calculateLeaseMetrics: financing is null or undefined');
			return null;
		}

		if (financing.financingType !== 'lease') {
			return null;
		}

		if (!financing.startDate) {
			if (DEV) console.warn('calculateLeaseMetrics: missing startDate');
			return null;
		}

		const startDate = new Date(financing.startDate);

		if (isNaN(startDate.getTime())) {
			if (DEV) console.warn('calculateLeaseMetrics: invalid startDate');
			return null;
		}

		const endDate = financing.endDate
			? new Date(financing.endDate)
			: new Date(startDate.getTime() + financing.termMonths * 30 * 24 * 60 * 60 * 1000);

		if (isNaN(endDate.getTime())) {
			if (DEV) console.warn('calculateLeaseMetrics: invalid endDate');
			return null;
		}

		const now = new Date();

		const totalDays = Math.floor((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
		const daysElapsed = Math.floor((now.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
		const daysRemaining = Math.max(0, totalDays - daysElapsed);
		const monthsRemaining = Math.max(0, Math.ceil(daysRemaining / 30));

		// `mileageLimit` is the ANNUAL allowance (the form labels it "Annual Mileage Limit" + the schema
		// comment agrees), so the WHOLE-LEASE allowance the excess-fee projection compares against is
		// annual × (term / 12) — e.g. 12,000/yr on a 36-mo lease = 36,000 total. Comparing the lifetime
		// mileageUsed / projectedFinalMileage against the bare annual number (the prior bug, #64)
		// over-reported excess ~Nx for an N-year lease (a normal 30k-mi 3yr lease showed ~18k phantom
		// excess miles + fees). termMonths is `.notNull()`; fall back to the annual limit (term≈12mo) if 0.
		const leaseYears = financing.termMonths > 0 ? financing.termMonths / 12 : 1;
		const totalMileageAllowance = (financing.mileageLimit || 0) * leaseYears;

		let mileageUsed = 0;
		let mileageRemaining = totalMileageAllowance;
		let projectedFinalMileage = currentMileage || 0;
		let projectedExcessMiles = 0;
		let projectedExcessFee = 0;
		let isOverMileage = false;

		if (currentMileage !== null && initialMileage !== null && financing.mileageLimit) {
			mileageUsed = Math.max(0, currentMileage - initialMileage);
			const milesPerDay = daysElapsed > 0 ? mileageUsed / daysElapsed : 0;
			projectedFinalMileage = currentMileage + milesPerDay * daysRemaining;
			// `totalMileageAllowance` is a DRIVEN-miles budget (annual × years) and `mileageUsed` is driven
			// miles (current − initial), but `projectedFinalMileage` is an ABSOLUTE odometer reading. The
			// excess must compare like with like: project DRIVEN miles forward, not the odometer. Comparing
			// the absolute reading against the driven budget over-reported excess (and the $ fee) by exactly
			// `initialMileage` for any lease signed on a car with miles on it (a used-car lease, or the
			// odometer not reset) — e.g. a 40k-mile car leased and driven on-pace showed a large phantom
			// excess fee. (Sibling to #64, which fixed the allowance scaling but left this space mismatch.)
			const projectedDrivenMiles = Math.max(0, projectedFinalMileage - initialMileage);
			projectedExcessMiles = Math.max(0, projectedDrivenMiles - totalMileageAllowance);
			projectedExcessFee = projectedExcessMiles * (financing.excessMileageFee || 0);
			isOverMileage = projectedExcessMiles > 0;
			mileageRemaining = Math.max(0, totalMileageAllowance - mileageUsed);
		}

		return {
			monthsRemaining,
			daysRemaining,
			mileageUsed,
			mileageRemaining,
			projectedFinalMileage,
			projectedExcessMiles,
			projectedExcessFee,
			isOverMileage
		};
	} catch (error) {
		if (DEV) console.error('Error calculating lease metrics:', error);
		return null;
	}
}

export function formatPaymentFrequency(frequency: string): string {
	const frequencyMap: Record<string, string> = {
		monthly: 'Monthly',
		'bi-weekly': 'Bi-weekly',
		weekly: 'Weekly',
		custom: 'Custom'
	};

	return frequencyMap[frequency] || frequency;
}

export function calculateDaysUntil(targetDate: Date): number {
	const now = new Date();
	const diffTime = targetDate.getTime() - now.getTime();
	return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}
/**
 * Calculate the minimum monthly payment for a loan using the standard amortization formula:
 * M = P * [r(1+r)^n] / [(1+r)^n - 1]
 * Returns null for leases or loans without APR (minimum = paymentAmount in those cases).
 */
export function calculateMinimumPayment(financing: VehicleFinancing): number | null {
	if (financing.financingType !== 'loan' || !financing.apr || financing.apr <= 0) {
		return null;
	}

	if (
		!financing.originalAmount ||
		financing.originalAmount <= 0 ||
		!financing.termMonths ||
		financing.termMonths <= 0
	) {
		return null;
	}

	const monthlyRate = financing.apr / 100 / 12;
	const n = financing.termMonths;
	const factor = Math.pow(1 + monthlyRate, n);
	const minimumPayment = (financing.originalAmount * (monthlyRate * factor)) / (factor - 1);

	return Math.round(minimumPayment * 100) / 100;
}

/**
 * Derives payment entries from financing expenses and vehicle financing config.
 * Sorts expenses by date ascending, assigns sequential payment numbers,
 * computes remaining balances, and looks up principal/interest from amortization schedule.
 */
export function derivePaymentEntries(
	expenses: Expense[],
	financing: VehicleFinancing
): DerivedPaymentEntry[] {
	const sorted = [...expenses].sort(
		(a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
	);

	const isLoanWithApr =
		financing.financingType === 'loan' && financing.apr != null && financing.apr > 0;

	const schedule = isLoanWithApr ? calculateAmortizationSchedule(financing, sorted.length) : [];

	let cumulativeAmount = 0;

	return sorted.map((expense, index) => {
		cumulativeAmount += expense.amount;
		const paymentNumber = index + 1;
		const remainingBalance = Math.max(0, financing.originalAmount - cumulativeAmount);

		const scheduleEntry = schedule[index];
		const principalAmount =
			isLoanWithApr && scheduleEntry ? scheduleEntry.principalAmount : expense.amount;
		const interestAmount = isLoanWithApr && scheduleEntry ? scheduleEntry.interestAmount : 0;

		const paymentType: 'extra' | 'standard' =
			expense.amount > financing.paymentAmount ? 'extra' : 'standard';

		return {
			expense,
			paymentNumber,
			remainingBalance,
			principalAmount,
			interestAmount,
			paymentType
		};
	});
}

/**
 * Calculate a payoff date by adding N months to a start date.
 * Used by the vehicle form's amortization preview.
 */
export function calculatePayoffDateFromStart(
	startDateStr: string | undefined,
	numPayments: number
): Date {
	const start = startDateStr ? new Date(startDateStr) : new Date();
	const targetMonth = start.getMonth() + numPayments;
	const payoff = new Date(start.getFullYear(), targetMonth, start.getDate());
	// If the day overflowed (e.g. Jan 31 + 1 month → Mar 3), clamp to last day of target month
	if (payoff.getDate() !== start.getDate()) {
		payoff.setDate(0); // Sets to last day of previous month (i.e. the intended target month)
	}
	return payoff;
}
