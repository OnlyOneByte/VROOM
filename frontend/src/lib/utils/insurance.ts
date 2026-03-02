import type { FinanceDetails, InsurancePolicy, PolicyDetails, PolicyTerm } from '$lib/types';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Returns the number of days remaining until the term end date.
 * Negative values indicate the term has already expired.
 */
export function getDaysRemaining(currentTermEnd: string | Date): number {
	const endDate = currentTermEnd instanceof Date ? currentTermEnd : new Date(currentTermEnd);
	const now = new Date();
	return Math.ceil((endDate.getTime() - now.getTime()) / DAY_MS);
}

/**
 * Returns true if the term end date is within the threshold (default 30 days).
 */
export function isExpiringSoon(currentTermEnd: string | Date, thresholdDays = 30): boolean {
	const days = getDaysRemaining(currentTermEnd);
	return days >= 0 && days <= thresholdDays;
}

/**
 * Returns a new array of terms sorted by endDate descending (most recent first).
 */
export function sortTermsByEndDateDesc(terms: PolicyTerm[]): PolicyTerm[] {
	return [...terms].sort((a, b) => new Date(b.endDate).getTime() - new Date(a.endDate).getTime());
}

/**
 * Groups policies into active and inactive buckets.
 */
export function groupPoliciesByActive(policies: InsurancePolicy[]): {
	active: InsurancePolicy[];
	inactive: InsurancePolicy[];
} {
	const active: InsurancePolicy[] = [];
	const inactive: InsurancePolicy[] = [];
	for (const policy of policies) {
		if (policy.isActive) {
			active.push(policy);
		} else {
			inactive.push(policy);
		}
	}
	return { active, inactive };
}

/**
 * Returns the term with the latest endDate, or undefined if the array is empty.
 */
export function getLatestTerm(terms: PolicyTerm[]): PolicyTerm | undefined {
	if (terms.length === 0) return undefined;
	let latest = terms[0] as PolicyTerm;
	for (let i = 1; i < terms.length; i++) {
		const term = terms[i] as PolicyTerm;
		if (new Date(term.endDate).getTime() > new Date(latest.endDate).getTime()) {
			latest = term;
		}
	}
	return latest;
}

/**
 * Deep-copies policyDetails and financeDetails from a term for renewal pre-fill.
 */
export function prefillFromPreviousTerm(term: PolicyTerm): {
	policyDetails: PolicyDetails;
	financeDetails: FinanceDetails;
} {
	return {
		policyDetails: structuredClone(term.policyDetails),
		financeDetails: structuredClone(term.financeDetails)
	};
}
