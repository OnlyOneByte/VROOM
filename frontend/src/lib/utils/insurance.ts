import type { InsurancePolicy, InsuranceTerm } from '#lib/types/index.ts';

const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function localDayNumber(date: Date): number {
	return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY_MS;
}

export function getDaysRemaining(termEnd: string | Date, now: Date = new Date()): number {
	const end =
		termEnd instanceof Date
			? termEnd
			: new Date(DATE_ONLY.test(termEnd) ? `${termEnd}T00:00:00` : termEnd);
	return localDayNumber(end) - localDayNumber(now);
}

export function enteredAmount(value: string | number | null | undefined): number | undefined {
	if (value === null || value === undefined || value === '') return undefined;
	const amount = Number(value);
	return Number.isFinite(amount) ? amount : undefined;
}

export function sortTermsByEndDateDesc(terms: InsuranceTerm[]): InsuranceTerm[] {
	return [...terms].sort((a, b) => new Date(b.endDate).getTime() - new Date(a.endDate).getTime());
}

export function hasTermEnded(
	term: Pick<InsuranceTerm, 'endDate'>,
	now: Date = new Date()
): boolean {
	return getDaysRemaining(term.endDate, now) < 0;
}

export function isPolicyInForce(policy: InsurancePolicy, now: Date = new Date()): boolean {
	return policy.isActive && policy.terms.some(term => !hasTermEnded(term, now));
}

export function groupPoliciesByActive(
	policies: InsurancePolicy[],
	now: Date = new Date()
): {
	active: InsurancePolicy[];
	inactive: InsurancePolicy[];
} {
	const active: InsurancePolicy[] = [];
	const inactive: InsurancePolicy[] = [];
	for (const policy of policies) {
		if (isPolicyInForce(policy, now)) {
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
