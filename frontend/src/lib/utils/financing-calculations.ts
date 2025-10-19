import type { VehicleFinancing } from '$lib/types';
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

/**
 * Generate an amortization schedule for a loan (internal implementation)
 * @param financing - The vehicle financing object
 * @param paidPaymentCount - Number of payments already made (to mark as paid)
 * @returns Array of amortization entries
 */
function calculateAmortizationScheduleImpl(
	financing: VehicleFinancing,
	paidPaymentCount = 0
): AmortizationEntry[] {
	try {
		// Validate financing data
		if (!financing) {
			console.warn('calculateAmortizationSchedule: financing is null or undefined');
			return [];
		}

		// Only generate for loans with APR
		if (financing.financingType !== 'loan' || !financing.apr || financing.apr <= 0) {
			return [];
		}

		// Validate required fields
		if (!financing.originalAmount || financing.originalAmount <= 0) {
			console.warn('calculateAmortizationSchedule: invalid originalAmount');
			return [];
		}

		if (!financing.paymentAmount || financing.paymentAmount <= 0) {
			console.warn('calculateAmortizationSchedule: invalid paymentAmount');
			return [];
		}

		if (!financing.termMonths || financing.termMonths <= 0) {
			console.warn('calculateAmortizationSchedule: invalid termMonths');
			return [];
		}

		if (!financing.startDate) {
			console.warn('calculateAmortizationSchedule: missing startDate');
			return [];
		}

		const schedule: AmortizationEntry[] = [];
		const monthlyRate = financing.apr / 100 / 12;
		const totalPayments = financing.termMonths;
		let remainingBalance = financing.originalAmount;
		const startDate = new Date(financing.startDate);

		// Validate start date
		if (isNaN(startDate.getTime())) {
			console.warn('calculateAmortizationSchedule: invalid startDate');
			return [];
		}

		for (let i = 1; i <= totalPayments; i++) {
			// Calculate interest for this period
			const interestAmount = remainingBalance * monthlyRate;

			// Principal is payment minus interest
			const principalAmount = Math.min(financing.paymentAmount - interestAmount, remainingBalance);

			// Update remaining balance
			remainingBalance = Math.max(0, remainingBalance - principalAmount);

			// Calculate payment date
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

			// Stop if balance is paid off
			if (remainingBalance === 0) {
				break;
			}
		}

		return schedule;
	} catch (error) {
		console.error('Error calculating amortization schedule:', error);
		return [];
	}
}

/**
 * Calculate a specific payment date based on start date and payment number
 * @param startDate - The financing start date
 * @param paymentNumber - Which payment (1-indexed)
 * @param frequency - Payment frequency
 * @returns The calculated payment date
 */
function calculatePaymentDate(startDate: Date, paymentNumber: number, frequency: string): Date {
	try {
		const date = new Date(startDate);

		// Validate date
		if (isNaN(date.getTime())) {
			console.warn('calculatePaymentDate: invalid startDate, using current date');
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
				// For custom, default to monthly
				date.setMonth(date.getMonth() + paymentNumber);
		}

		return date;
	} catch (error) {
		console.error('Error calculating payment date:', error);
		return new Date();
	}
}

/**
 * Calculate the next payment due date
 * @param financing - The vehicle financing object
 * @param lastPaymentDate - Date of the last payment (optional)
 * @returns The next payment due date
 */
export function calculateNextPaymentDate(
	financing: VehicleFinancing,
	lastPaymentDate?: Date
): Date {
	try {
		// Validate financing data
		if (!financing || !financing.startDate) {
			console.warn('calculateNextPaymentDate: invalid financing data');
			return new Date();
		}

		const baseDate = lastPaymentDate || new Date(financing.startDate);
		const today = new Date();
		const nextDate = new Date(baseDate);

		// Validate dates
		if (isNaN(nextDate.getTime())) {
			console.warn('calculateNextPaymentDate: invalid base date');
			return new Date();
		}

		// Safety counter to prevent infinite loops
		let iterations = 0;
		const maxIterations = 1000;

		// Keep adding payment periods until we find a future date
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
			console.warn('calculateNextPaymentDate: max iterations reached');
			return new Date();
		}

		return nextDate;
	} catch (error) {
		console.error('Error calculating next payment date:', error);
		return new Date();
	}
}

/**
 * Calculate the estimated payoff date based on current balance and payment schedule
 * @param financing - The vehicle financing object
 * @returns The estimated payoff date
 */
export function calculatePayoffDate(financing: VehicleFinancing): Date {
	try {
		// Validate financing data
		if (!financing) {
			console.warn('calculatePayoffDate: financing is null or undefined');
			return new Date();
		}

		if (financing.currentBalance <= 0) {
			return new Date(); // Already paid off
		}

		// Validate payment amount
		if (!financing.paymentAmount || financing.paymentAmount <= 0) {
			console.warn('calculatePayoffDate: invalid paymentAmount');
			return new Date();
		}

		// For leases or loans without APR, use simple division
		if (financing.financingType === 'lease' || !financing.apr || financing.apr <= 0) {
			const paymentsRemaining = Math.ceil(financing.currentBalance / financing.paymentAmount);
			return calculatePaymentDate(new Date(), paymentsRemaining, financing.paymentFrequency);
		}

		// For loans with APR, calculate using amortization
		const monthlyRate = financing.apr / 100 / 12;
		let balance = financing.currentBalance;
		let paymentsRemaining = 0;

		while (balance > 0 && paymentsRemaining < financing.termMonths * 2) {
			const interestAmount = balance * monthlyRate;
			const principalAmount = Math.min(financing.paymentAmount - interestAmount, balance);

			// Prevent infinite loop if payment doesn't cover interest
			if (principalAmount <= 0) {
				console.warn('calculatePayoffDate: payment does not cover interest');
				return new Date();
			}

			balance -= principalAmount;
			paymentsRemaining++;
		}

		return calculatePaymentDate(new Date(), paymentsRemaining, financing.paymentFrequency);
	} catch (error) {
		console.error('Error calculating payoff date:', error);
		return new Date();
	}
}

/**
 * Generate an amortization schedule for a loan (memoized)
 * @param financing - The vehicle financing object
 * @param paidPaymentCount - Number of payments already made (to mark as paid)
 * @returns Array of amortization entries
 */
export const calculateAmortizationSchedule = memoizeMulti(calculateAmortizationScheduleImpl);

/**
 * Calculate the impact of making extra payments (internal implementation)
 * @param financing - The vehicle financing object
 * @param extraPaymentAmount - The extra amount to pay per period
 * @returns Impact analysis of the extra payment
 */
function calculateExtraPaymentImpactImpl(
	financing: VehicleFinancing,
	extraPaymentAmount: number
): ExtraPaymentImpact {
	try {
		// Validate financing data
		if (!financing) {
			console.warn('calculateExtraPaymentImpact: financing is null or undefined');
			return {
				extraPaymentAmount,
				newPayoffDate: new Date(),
				monthsSaved: 0,
				interestSaved: 0,
				totalSavings: 0
			};
		}

		// Only applicable to loans
		if (financing.financingType !== 'loan' || !financing.apr || financing.apr <= 0) {
			return {
				extraPaymentAmount,
				newPayoffDate: calculatePayoffDate(financing),
				monthsSaved: 0,
				interestSaved: 0,
				totalSavings: 0
			};
		}

		// Validate extra payment amount
		if (extraPaymentAmount <= 0) {
			return {
				extraPaymentAmount,
				newPayoffDate: calculatePayoffDate(financing),
				monthsSaved: 0,
				interestSaved: 0,
				totalSavings: 0
			};
		}

		const monthlyRate = financing.apr / 100 / 12;
		const newPaymentAmount = financing.paymentAmount + extraPaymentAmount;

		// Calculate original scenario
		let originalBalance = financing.currentBalance;
		let originalMonths = 0;
		let originalTotalInterest = 0;

		while (originalBalance > 0 && originalMonths < financing.termMonths * 2) {
			const interestAmount = originalBalance * monthlyRate;
			const principalAmount = Math.min(financing.paymentAmount - interestAmount, originalBalance);

			// Prevent infinite loop
			if (principalAmount <= 0) {
				console.warn('calculateExtraPaymentImpact: payment does not cover interest');
				break;
			}

			originalBalance -= principalAmount;
			originalTotalInterest += interestAmount;
			originalMonths++;
		}

		// Calculate new scenario with extra payment
		let newBalance = financing.currentBalance;
		let newMonths = 0;
		let newTotalInterest = 0;

		while (newBalance > 0 && newMonths < financing.termMonths * 2) {
			const interestAmount = newBalance * monthlyRate;
			const principalAmount = Math.min(newPaymentAmount - interestAmount, newBalance);

			// Prevent infinite loop
			if (principalAmount <= 0) {
				console.warn('calculateExtraPaymentImpact: new payment does not cover interest');
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
		console.error('Error calculating extra payment impact:', error);
		return {
			extraPaymentAmount,
			newPayoffDate: new Date(),
			monthsSaved: 0,
			interestSaved: 0,
			totalSavings: 0
		};
	}
}

/**
 * Calculate the impact of making extra payments (memoized)
 * @param financing - The vehicle financing object
 * @param extraPaymentAmount - The extra amount to pay per period
 * @returns Impact analysis of the extra payment
 */
export const calculateExtraPaymentImpact = memoizeMulti(calculateExtraPaymentImpactImpl);

/**
 * Calculate lease-specific metrics including mileage projections
 * @param financing - The vehicle financing object (must be a lease)
 * @param currentMileage - Current vehicle mileage
 * @param initialMileage - Initial vehicle mileage at lease start
 * @returns Lease metrics
 */
export function calculateLeaseMetrics(
	financing: VehicleFinancing,
	currentMileage: number | null,
	initialMileage: number | null
): LeaseMetrics | null {
	try {
		// Validate financing data
		if (!financing) {
			console.warn('calculateLeaseMetrics: financing is null or undefined');
			return null;
		}

		// Only applicable to leases
		if (financing.financingType !== 'lease') {
			return null;
		}

		// Validate start date
		if (!financing.startDate) {
			console.warn('calculateLeaseMetrics: missing startDate');
			return null;
		}

		const startDate = new Date(financing.startDate);

		// Validate date
		if (isNaN(startDate.getTime())) {
			console.warn('calculateLeaseMetrics: invalid startDate');
			return null;
		}

		const endDate = financing.endDate
			? new Date(financing.endDate)
			: new Date(startDate.getTime() + financing.termMonths * 30 * 24 * 60 * 60 * 1000);

		// Validate end date
		if (isNaN(endDate.getTime())) {
			console.warn('calculateLeaseMetrics: invalid endDate');
			return null;
		}

		const now = new Date();

		// Calculate time metrics
		const totalDays = Math.floor((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
		const daysElapsed = Math.floor((now.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
		const daysRemaining = Math.max(0, totalDays - daysElapsed);
		const monthsRemaining = Math.max(0, Math.ceil(daysRemaining / 30));

		// Calculate mileage metrics
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
		console.error('Error calculating lease metrics:', error);
		return null;
	}
}

/**
 * Format payment frequency for display
 * @param frequency - The payment frequency
 * @returns Formatted string
 */
export function formatPaymentFrequency(frequency: string): string {
	const frequencyMap: Record<string, string> = {
		monthly: 'Monthly',
		'bi-weekly': 'Bi-weekly',
		weekly: 'Weekly',
		custom: 'Custom'
	};

	return frequencyMap[frequency] || frequency;
}

/**
 * Calculate days until a specific date
 * @param targetDate - The target date
 * @returns Number of days until the date (negative if in the past)
 */
export function calculateDaysUntil(targetDate: Date): number {
	const now = new Date();
	const diffTime = targetDate.getTime() - now.getTime();
	return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}
