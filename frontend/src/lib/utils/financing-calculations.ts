import type { DerivedPaymentEntry, Expense, VehicleFinancing } from '#lib/types/index.ts';
import { dateOnlyToISO } from './formatters';
import { memoizeMulti } from './memoize';

export interface AmortizationEntry {
	paymentNumber: number;
	paymentDate: Date;
	paymentAmount: number;
	principalAmount: number;
	interestAmount: number;
	remainingBalance: number;
	isPaid: boolean;
}

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

export interface ExtraPaymentImpact {
	extraPaymentAmount: number;
	newPayoffDate: Date;
	monthsSaved: number;
	interestSaved: number;
	totalSavings: number;
}

const DEV = import.meta.env.DEV;

function addMonthsClamped(date: Date, months: number): Date {
	const result = new Date(date);
	const targetDay = result.getDate();
	result.setMonth(result.getMonth() + months);
	if (result.getDate() !== targetDay) {
		result.setDate(0);
	}
	return result;
}

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
				return addMonthsClamped(date, paymentNumber);
			case 'bi-weekly':
				date.setDate(date.getDate() + paymentNumber * 14);
				break;
			case 'weekly':
				date.setDate(date.getDate() + paymentNumber * 7);
				break;
			default:
				return addMonthsClamped(date, paymentNumber);
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
		let nextDate = new Date(baseDate);

		if (isNaN(nextDate.getTime())) {
			if (DEV) console.warn('calculateNextPaymentDate: invalid base date');
			return new Date();
		}

		let iterations = 0;
		const maxIterations = 1000;
		let monthsAdded = 0;

		while (nextDate <= today && iterations < maxIterations) {
			switch (financing.paymentFrequency) {
				case 'bi-weekly':
					nextDate.setDate(nextDate.getDate() + 14);
					break;
				case 'weekly':
					nextDate.setDate(nextDate.getDate() + 7);
					break;
				default:
					monthsAdded++;
					nextDate = addMonthsClamped(baseDate, monthsAdded);
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
			const startDate = new Date(financing.startDate);
			if (!isNaN(startDate.getTime())) {
				return addMonthsClamped(startDate, financing.termMonths);
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

export function resolveCurrentOdometer(
	currentOdometer: number | null | undefined,
	currentMileage: number | null | undefined,
	initialMileage: number | null | undefined
): number | null {
	return currentOdometer ?? currentMileage ?? initialMileage ?? null;
}

export function leaseTotalMileageAllowance(financing: VehicleFinancing): number {
	const leaseYears = financing.termMonths > 0 ? financing.termMonths / 12 : 1;
	return (financing.mileageLimit || 0) * leaseYears;
}

export function calculateLeaseOverage(
	financing: VehicleFinancing,
	mileageUsed: number
): { excessMiles: number; overageCost: number } {
	if (financing.financingType !== 'lease' || !financing.mileageLimit) {
		return { excessMiles: 0, overageCost: 0 };
	}
	const excessMiles = Math.max(0, mileageUsed - leaseTotalMileageAllowance(financing));
	return { excessMiles, overageCost: excessMiles * (financing.excessMileageFee ?? 0) };
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
			: addMonthsClamped(startDate, financing.termMonths);

		if (isNaN(endDate.getTime())) {
			if (DEV) console.warn('calculateLeaseMetrics: invalid endDate');
			return null;
		}

		const now = new Date();

		const totalDays = Math.floor((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
		const daysElapsed = Math.floor((now.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
		const daysRemaining = Math.max(0, totalDays - daysElapsed);
		const monthsRemaining = Math.max(0, Math.ceil(daysRemaining / 30));

		const totalMileageAllowance = leaseTotalMileageAllowance(financing);

		let mileageUsed = 0;
		let mileageRemaining = totalMileageAllowance;
		let projectedFinalMileage = currentMileage || 0;
		let projectedExcessMiles = 0;
		let projectedExcessFee = 0;
		let isOverMileage = false;

		const startMileage = initialMileage ?? 0;
		if (currentMileage !== null && financing.mileageLimit) {
			mileageUsed = Math.max(0, currentMileage - startMileage);
			const milesPerDay = daysElapsed > 0 ? mileageUsed / daysElapsed : 0;
			projectedFinalMileage = currentMileage + milesPerDay * daysRemaining;
			const projectedDrivenMiles = Math.max(0, projectedFinalMileage - startMileage);
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

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function parseStartDate(value: string | undefined): Date {
	if (!value) return new Date();
	if (!DATE_ONLY.test(value)) return new Date(value);
	return new Date(dateOnlyToISO(value));
}

export function calculatePayoffDateFromStart(
	startDateStr: string | undefined,
	numPayments: number
): Date {
	return addMonthsClamped(parseStartDate(startDateStr), numPayments);
}
