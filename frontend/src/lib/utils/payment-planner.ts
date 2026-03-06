import type { VehicleFinancing } from '$lib/types';
import {
	calculateExtraPaymentImpact,
	type ExtraPaymentImpact
} from '$lib/utils/financing-calculations';
import { formatCurrency } from '$lib/utils/formatters';

// --- Types ---

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

// --- Functions ---

/**
 * Compute the planner display state based on input, minimum, and saved amounts.
 *
 * Preconditions:
 *   - financing is a valid loan with apr > 0
 *   - minimumPayment > 0
 *   - inputAmount > 0
 *
 * Postconditions:
 *   - Returns 'below-minimum' iff inputAmount < minimumPayment
 *   - Returns 'at-minimum' iff inputAmount ≈ minimumPayment (within $0.01)
 *   - Returns 'with-delta' iff inputAmount > minimumPayment AND |inputAmount - savedAmount| > 0.01
 *   - Returns 'normal' iff inputAmount > minimumPayment AND |inputAmount - savedAmount| ≤ 0.01
 *   - No mutations to financing object
 */
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

	// Primary impact: input vs minimum
	const extraVsMinimum = inputAmount - minimumPayment;
	const financingAtMinimum = { ...financing, paymentAmount: minimumPayment };
	const primaryImpact = calculateExtraPaymentImpact(financingAtMinimum, extraVsMinimum);

	// Secondary delta: input vs saved (only when different)
	if (Math.abs(inputAmount - savedAmount) > 0.01) {
		const extraSavedVsMinimum = savedAmount - minimumPayment;
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

/**
 * Build a human-readable summary sentence for the current planner state.
 */
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

/**
 * Determine whether the Save button should be enabled.
 *
 * Save is enabled iff:
 *   - inputAmount >= minimumPayment
 *   - |inputAmount - savedAmount| > 0.01
 *   - not currently saving
 */
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
