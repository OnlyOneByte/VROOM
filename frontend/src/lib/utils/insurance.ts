import type { ClaimStatus, InsurancePolicy, InsuranceTerm } from '#lib/types/index.ts';
import { dateOnlyToISO, fromMinor, toMinor } from '#lib/utils/formatters.ts';

export const CLAIM_STATUS_LABELS: Record<ClaimStatus, string> = {
	filed: 'Filed',
	in_progress: 'In progress',
	settled: 'Settled',
	denied: 'Denied'
};

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

function utcDayClampedToMonth(year: number, month: number, day: number): number {
	const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
	return Date.UTC(year, month, Math.min(day, daysInMonth));
}

export function termBillingMonths(startDate: Date, endDate: Date): number {
	const startYear = startDate.getUTCFullYear();
	const startMonth = startDate.getUTCMonth();
	const endDay = Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth(), endDate.getUTCDate());
	const wholeCalendarMonths =
		(endDate.getUTCFullYear() - startYear) * 12 + (endDate.getUTCMonth() - startMonth);
	const lastBillingDay = utcDayClampedToMonth(
		startYear,
		startMonth + wholeCalendarMonths,
		startDate.getUTCDate()
	);
	const months = wholeCalendarMonths + (lastBillingDay < endDay ? 1 : 0);
	return Math.max(1, months);
}

export function effectiveTermCost(term: {
	totalCost: string;
	monthlyCost: string;
	startDate: string;
	endDate: string;
}): number {
	const totalCost = enteredAmount(term.totalCost) ?? 0;
	if (totalCost > 0) return totalCost;
	const monthlyCost = enteredAmount(term.monthlyCost) ?? 0;
	if (monthlyCost <= 0 || !term.startDate || !term.endDate) return 0;
	const months = termBillingMonths(
		new Date(dateOnlyToISO(term.startDate)),
		new Date(dateOnlyToISO(term.endDate))
	);
	return fromMinor(toMinor(monthlyCost) * months);
}

export function termFigures(term: InsuranceTerm): { total: number | null; monthly: number | null } {
	const months = termBillingMonths(new Date(term.startDate), new Date(term.endDate));
	const total = term.totalCost ?? 0;
	const monthly = term.monthlyCost ?? 0;
	if (total > 0) return { total, monthly: total / months };
	if (monthly > 0) return { total: fromMinor(toMinor(monthly) * months), monthly };
	return {
		total: term.totalCost === 0 ? 0 : null,
		monthly: term.monthlyCost === 0 ? 0 : null
	};
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

export function splitTermsByToday(
	terms: InsuranceTerm[],
	now: Date = new Date()
): {
	shown: InsuranceTerm | undefined;
	startsLater: boolean;
	upcoming: InsuranceTerm | undefined;
	others: InsuranceTerm[];
} {
	const started = (t: InsuranceTerm) => getDaysRemaining(t.startDate, now) <= 0;
	const byStart = (a: InsuranceTerm, b: InsuranceTerm) => a.startDate.localeCompare(b.startDate);
	const inForce = sortTermsByEndDateDesc(terms.filter(t => started(t) && !hasTermEnded(t, now)))[0];
	const future = terms.filter(t => !started(t)).sort(byStart);
	const shown = inForce ?? future[0] ?? getLatestTerm(terms);
	return {
		shown,
		startsLater: shown !== undefined && !started(shown),
		upcoming: future.find(t => t.id !== shown?.id),
		others: terms.filter(t => t.id !== shown?.id).sort((a, b) => byStart(b, a))
	};
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
