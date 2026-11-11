import type { InsurancePolicy, InsuranceTerm } from '$lib/types';

const DAY_MS = 24 * 60 * 60 * 1000;

export function getDaysRemaining(currentTermEnd: string | Date): number {
	const endDate = currentTermEnd instanceof Date ? currentTermEnd : new Date(currentTermEnd);
	const now = new Date();
	return Math.ceil((endDate.getTime() - now.getTime()) / DAY_MS);
}

export function isExpiringSoon(currentTermEnd: string | Date, thresholdDays = 30): boolean {
	const days = getDaysRemaining(currentTermEnd);
	return days >= 0 && days <= thresholdDays;
}

export function sortTermsByEndDateDesc(terms: InsuranceTerm[]): InsuranceTerm[] {
	return [...terms].sort((a, b) => new Date(b.endDate).getTime() - new Date(a.endDate).getTime());
}

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

export function getLatestTerm(terms: InsuranceTerm[]): InsuranceTerm | undefined {
	if (terms.length === 0) return undefined;
	let latest = terms[0] as InsuranceTerm;
	for (let i = 1; i < terms.length; i++) {
		const term = terms[i] as InsuranceTerm;
		if (new Date(term.endDate).getTime() > new Date(latest.endDate).getTime()) {
			latest = term;
		}
	}
	return latest;
}

export function prefillFromPreviousTerm(
	term: InsuranceTerm
): Omit<InsuranceTerm, 'id' | 'policyId' | 'startDate' | 'endDate' | 'createdAt' | 'updatedAt'> {
	return {
		policyNumber: term.policyNumber,
		coverageDescription: term.coverageDescription,
		deductibleAmount: term.deductibleAmount,
		coverageLimit: term.coverageLimit,
		agentName: term.agentName,
		agentPhone: term.agentPhone,
		agentEmail: term.agentEmail,
		totalCost: term.totalCost,
		monthlyCost: term.monthlyCost,
		premiumFrequency: term.premiumFrequency,
		paymentAmount: term.paymentAmount
	};
}
