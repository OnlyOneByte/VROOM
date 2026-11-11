import type { VehicleFinancing } from '$lib/types';
import {
	calculateExtraPaymentImpact,
	type ExtraPaymentImpact
} from '$lib/utils/financing-calculations';
import { formatCurrency } from '$lib/utils/formatters';

export interface SecondaryDelta {
	monthsDelta: number;
	interestDelta: number;
	direction: 'better' | 'worse';
}

export type PlannerState =
	| { state: 'below-minimum'; error: string }
	| { state: 'at-minimum'; message: string }
	| { state: 'normal'; primaryImpact: ExtraPaymentImpact }
	| {
			state: 'with-delta';
			primaryImpact: ExtraPaymentImpact;
			secondaryDelta: SecondaryDelta;
	  };

export function computePlannerState(
	financing: VehicleFinancing,
	inputAmount: number,
	minimumPayment: number,
	savedAmount: number
): PlannerState {
	if (inputAmount < minimumPayment - 0.01) {
		return {
			state: 'below-minimum',
			error: `Minimum payment is ${formatCurrency(minimumPayment)}`
		};
	}

	if (Math.abs(inputAmount - minimumPayment) <= 0.01) {
		return {
			state: 'at-minimum',
			message: 'This is the minimum payment. No extra savings.'
		};
	}

	// A 0%-APR loan has no minimum payment, so fall back to the contractual payment.
	const baselinePayment = minimumPayment > 0 ? minimumPayment : financing.paymentAmount;

	const extraVsMinimum = inputAmount - baselinePayment;
	const financingAtMinimum = { ...financing, paymentAmount: baselinePayment };
	const primaryImpact = calculateExtraPaymentImpact(financingAtMinimum, extraVsMinimum);

	if (Math.abs(inputAmount - savedAmount) > 0.01) {
		const extraSavedVsMinimum = savedAmount - baselinePayment;
		const savedImpact = calculateExtraPaymentImpact(financingAtMinimum, extraSavedVsMinimum);

		const secondaryDelta: SecondaryDelta = {
			monthsDelta: primaryImpact.monthsSaved - savedImpact.monthsSaved,
			interestDelta: primaryImpact.interestSaved - savedImpact.interestSaved,
			direction: inputAmount > savedAmount ? 'better' : 'worse'
		};

		return { state: 'with-delta', primaryImpact, secondaryDelta };
	}

	return { state: 'normal', primaryImpact };
}

function formatMonths(months: number): string {
	if (months === 1) return '1 month';
	return `${months} months`;
}

export function buildSummary(
	inputAmount: number,
	savedAmount: number,
	minimumPayment: number,
	primaryImpact: ExtraPaymentImpact,
	secondaryDelta: SecondaryDelta | null
): string {
	if (inputAmount <= minimumPayment + 0.01) {
		return 'This is the minimum payment. No extra savings.';
	}

	if (!secondaryDelta) {
		return `Your current payment of ${formatCurrency(inputAmount)}/mo saves ${formatMonths(primaryImpact.monthsSaved)} and ${formatCurrency(primaryImpact.interestSaved)} vs the minimum.`;
	}

	const base = `Paying ${formatCurrency(inputAmount)}/mo saves ${formatMonths(primaryImpact.monthsSaved)} and ${formatCurrency(primaryImpact.interestSaved)} vs minimum.`;
	const moreOrLess = secondaryDelta.direction === 'better' ? 'more' : 'less';
	const deltaMonths = Math.abs(secondaryDelta.monthsDelta);
	const deltaInterest = Math.abs(secondaryDelta.interestDelta);

	return `${base} That's ${formatMonths(deltaMonths)} and ${formatCurrency(deltaInterest)} ${moreOrLess} than your current ${formatCurrency(savedAmount)}/mo.`;
}

export function canSave(
	inputAmount: number,
	minimumPayment: number,
	savedAmount: number,
	isSaving: boolean
): boolean {
	return (
		inputAmount >= minimumPayment - 0.01 && Math.abs(inputAmount - savedAmount) > 0.01 && !isSaving
	);
}
