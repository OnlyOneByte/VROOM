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

		if (financing.currentBalance <= 0) {
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
			const paymentsRemaining = Math.ceil(financing.currentBalance / financing.paymentAmount);
			return calculatePaymentDate(new Date(), paymentsRemaining, financing.paymentFrequency);
		}

		const monthlyRate = financing.apr / 100 / 12;
		let balance = financing.currentBalance;
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

		if (financing.financingType !== 'loan' || !financing.apr || financing.apr <= 0) {
			return { ...defaultResult, newPayoffDate: calculatePayoffDate(financing) };
		}

		if (extraPaymentAmount <= 0) {
			return { ...defaultResult, newPayoffDate: calculatePayoffDate(financing) };
		}

		const monthlyRate = financing.apr / 100 / 12;
		const newPaymentAmount = financing.paymentAmount + extraPaymentAmount;

		let originalBalance = financing.currentBalance;
		let originalMonths = 0;
		let originalTotalInterest = 0;

		while (originalBalance > 0 && originalMonths < financing.termMonths * 2) {
			const interestAmount = originalBalance * monthlyRate;
			const principalAmount = Math.min(financing.paymentAmount - interestAmount, originalBalance);

			if (principalAmount <= 0) {
				if (DEV) console.warn('calculateExtraPaymentImpact: payment does not cover interest');
				break;
			}

			originalBalance -= principalAmount;
			originalTotalInterest += interestAmount;
			originalMonths++;
		}

		let newBalance = financing.currentBalance;
		let newMonths = 0;
		let newTotalInterest = 0;

		while (newBalance > 0 && newMonths < financing.termMonths * 2) {
			const interestAmount = newBalance * monthlyRate;
			const principalAmount = Math.min(newPaymentAmount - interestAmount, newBalance);

			if (principalAmount <= 0) {
				if (DEV) console.warn('calculateExtraPaymentImpact: new payment does not cover interest');
				break;
			}

			newBalance -= principalAmount;
			newTotalInterest += interestAmount;
			newMonths++;
		}

		const monthsSaved = Math.max(0, originalMonths - newMonths);
		const interestSaved = Math.max(0, originalTotalInterest - newTotalInterest);
		const newPayoffDate = calculatePaymentDate(new Date(), newMonths, financing.paymentFrequency);

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

		let mileageUsed = 0;
		let mileageRemaining = financing.mileageLimit || 0;
		let projectedFinalMileage = currentMileage || 0;
		let projectedExcessMiles = 0;
		let projectedExcessFee = 0;
		let isOverMileage = false;

		if (currentMileage !== null && initialMileage !== null && financing.mileageLimit) {
			mileageUsed = Math.max(0, currentMileage - initialMileage);
			const milesPerDay = daysElapsed > 0 ? mileageUsed / daysElapsed : 0;
			projectedFinalMileage = currentMileage + milesPerDay * daysRemaining;
			projectedExcessMiles = Math.max(0, projectedFinalMileage - financing.mileageLimit);
			projectedExcessFee = projectedExcessMiles * (financing.excessMileageFee || 0);
			isOverMileage = projectedExcessMiles > 0;
			mileageRemaining = Math.max(0, financing.mileageLimit - mileageUsed);
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
