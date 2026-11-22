import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import fc from 'fast-check';
import type { InsuranceTerm, InsurancePolicy } from '#lib/types/index.ts';
import {
	effectiveTermCost,
	getDaysRemaining,
	getLatestTerm,
	groupPoliciesByActive,
	isPolicyInForce,
	prefillFromPreviousTerm,
	sortTermsByEndDateDesc,
	termBillingMonths
} from '#lib/utils/insurance.ts';

const DAY_MS = 24 * 60 * 60 * 1000;

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', '..');
const TERM_BILLING_CASES = JSON.parse(
	readFileSync(
		join(REPO_ROOT, 'backend/src/utils/__tests__/term-billing-months.cases.json'),
		'utf8'
	)
) as { start: string; end: string; months: number }[];

let idCounter = 0;

const arbInsuranceTerm: fc.Arbitrary<InsuranceTerm> = fc
	.record({
		startTs: fc.integer({ min: 946684800000, max: 2524608000000 }),
		durationDays: fc.integer({ min: 1, max: 730 }),
		policyNumber: fc.option(fc.string({ minLength: 1, maxLength: 20 }), { nil: undefined }),
		coverageDescription: fc.option(fc.string({ minLength: 1, maxLength: 50 }), {
			nil: undefined
		}),
		deductibleAmount: fc.option(
			fc.double({ min: 1, max: 10000, noNaN: true, noDefaultInfinity: true }),
			{ nil: undefined }
		),
		coverageLimit: fc.option(
			fc.double({ min: 1, max: 1000000, noNaN: true, noDefaultInfinity: true }),
			{ nil: undefined }
		),
		agentName: fc.option(fc.string({ minLength: 1, maxLength: 30 }), { nil: undefined }),
		agentPhone: fc.option(fc.string({ minLength: 1, maxLength: 15 }), { nil: undefined }),
		agentEmail: fc.option(fc.string({ minLength: 1, maxLength: 30 }), { nil: undefined }),
		totalCost: fc.option(fc.double({ min: 0, max: 50000, noNaN: true, noDefaultInfinity: true }), {
			nil: undefined
		}),
		monthlyCost: fc.option(fc.double({ min: 0, max: 5000, noNaN: true, noDefaultInfinity: true }), {
			nil: undefined
		}),
		premiumFrequency: fc.option(fc.constantFrom('monthly', 'quarterly', 'annual'), {
			nil: undefined
		}),
		paymentAmount: fc.option(
			fc.double({ min: 0, max: 5000, noNaN: true, noDefaultInfinity: true }),
			{ nil: undefined }
		)
	})
	.map(({ startTs, durationDays, ...rest }) => {
		idCounter++;
		const startDate = new Date(startTs).toISOString().split('T')[0] as string;
		const endDate = new Date(startTs + durationDays * DAY_MS).toISOString().split('T')[0] as string;
		return {
			id: `term-${idCounter}`,
			policyId: `policy-${idCounter}`,
			startDate,
			endDate,
			...rest,
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString()
		};
	});

const arbInsurancePolicy: fc.Arbitrary<InsurancePolicy> = fc
	.record({
		isActive: fc.boolean(),
		terms: fc.array(arbInsuranceTerm, { minLength: 1, maxLength: 5 })
	})
	.map(({ isActive, terms }) => {
		idCounter++;
		return {
			id: `policy-${idCounter}`,
			company: `Company ${idCounter}`,
			isActive,
			terms,
			vehicleIds: [`vehicle-${idCounter}`],
			termVehicleCoverage: [],
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString()
		};
	});

describe('Policy active/inactive grouping', () => {
	test('active group contains only in-force policies', () => {
		fc.assert(
			fc.property(fc.array(arbInsurancePolicy, { minLength: 0, maxLength: 20 }), policies => {
				const now = new Date();
				const { active } = groupPoliciesByActive(policies, now);
				for (const policy of active) {
					expect(isPolicyInForce(policy, now)).toBe(true);
				}
			}),
			{ numRuns: 100 }
		);
	});

	test('inactive group contains every deactivated or expired policy', () => {
		fc.assert(
			fc.property(fc.array(arbInsurancePolicy, { minLength: 0, maxLength: 20 }), policies => {
				const now = new Date();
				const { inactive } = groupPoliciesByActive(policies, now);
				for (const policy of inactive) {
					expect(isPolicyInForce(policy, now)).toBe(false);
				}
			}),
			{ numRuns: 100 }
		);
	});

	test('total count of active + inactive equals input count', () => {
		fc.assert(
			fc.property(fc.array(arbInsurancePolicy, { minLength: 0, maxLength: 20 }), policies => {
				const { active, inactive } = groupPoliciesByActive(policies);
				expect(active.length + inactive.length).toBe(policies.length);
			}),
			{ numRuns: 100 }
		);
	});
});

describe('Expiration alert computation', () => {
	test('getDaysRemaining is within a day of ceil((endDate - now) / dayMs)', () => {
		fc.assert(
			fc.property(fc.integer({ min: -365, max: 365 }), offsetDays => {
				const now = new Date();
				const endDate = new Date(now.getTime() + offsetDays * DAY_MS);
				const endDateStr = endDate.toISOString();

				const result = getDaysRemaining(endDateStr);
				const expected = Math.ceil((endDate.getTime() - now.getTime()) / DAY_MS);

				expect(Math.abs(result - expected)).toBeLessThanOrEqual(1);
			}),
			{ numRuns: 100 }
		);
	});
});

describe('Term history ordering', () => {
	test('sortTermsByEndDateDesc returns terms in descending endDate order', () => {
		fc.assert(
			fc.property(fc.array(arbInsuranceTerm, { minLength: 0, maxLength: 20 }), terms => {
				const sorted = sortTermsByEndDateDesc(terms);
				expect(sorted.length).toBe(terms.length);
				for (let i = 1; i < sorted.length; i++) {
					const prev = sorted[i - 1] as InsuranceTerm;
					const curr = sorted[i] as InsuranceTerm;
					expect(new Date(prev.endDate).getTime()).toBeGreaterThanOrEqual(
						new Date(curr.endDate).getTime()
					);
				}
			}),
			{ numRuns: 100 }
		);
	});

	test('sortTermsByEndDateDesc preserves all elements', () => {
		fc.assert(
			fc.property(fc.array(arbInsuranceTerm, { minLength: 0, maxLength: 20 }), terms => {
				const sorted = sortTermsByEndDateDesc(terms);
				const inputIds = terms.map(t => t.id).sort();
				const sortedIds = sorted.map(t => t.id).sort();
				expect(sortedIds).toEqual(inputIds);
			}),
			{ numRuns: 100 }
		);
	});
});

describe('Renew pre-fill from previous term', () => {
	test('prefillFromPreviousTerm copies flat fields from the term', () => {
		fc.assert(
			fc.property(arbInsuranceTerm, term => {
				const prefilled = prefillFromPreviousTerm(term);

				expect(prefilled.policyNumber).toEqual(term.policyNumber);
				expect(prefilled.coverageDescription).toEqual(term.coverageDescription);
				expect(prefilled.totalCost).toEqual(term.totalCost);
				expect(prefilled.monthlyCost).toEqual(term.monthlyCost);
			}),
			{ numRuns: 100 }
		);
	});

	test('getLatestTerm returns the term with the max endDate', () => {
		fc.assert(
			fc.property(fc.array(arbInsuranceTerm, { minLength: 1, maxLength: 10 }), terms => {
				const latest = getLatestTerm(terms);
				expect(latest).toBeDefined();

				for (const term of terms) {
					expect(new Date(latest!.endDate).getTime()).toBeGreaterThanOrEqual(
						new Date(term.endDate).getTime()
					);
				}
			}),
			{ numRuns: 100 }
		);
	});

	test('getLatestTerm: on an equal-endDate tie the FIRST term wins (the load-bearing `>`, not `>=`)', () => {
		const base = {
			policyId: 'policy-1',
			startDate: '2024-01-01',
			endDate: '2024-12-31',
			createdAt: '2024-01-01T00:00:00.000Z',
			updatedAt: '2024-01-01T00:00:00.000Z'
		};
		const termA: InsuranceTerm = { ...base, id: 'term-A', policyNumber: 'POL-A' };
		const termB: InsuranceTerm = { ...base, id: 'term-B', policyNumber: 'POL-B' };

		expect(getLatestTerm([termA, termB])?.id).toBe('term-A');
		expect(getLatestTerm([termB, termA])?.id).toBe('term-B');
	});
});

describe('term premium matches what the API charges', () => {
	test.each(TERM_BILLING_CASES)(
		'$start -> $end is $months billed months',
		({ start, end, months }) => {
			expect(termBillingMonths(new Date(start), new Date(end))).toBe(months);
		}
	);

	test('a monthly-only term costs the monthly cost times its billed months', () => {
		expect(
			effectiveTermCost({
				totalCost: '',
				monthlyCost: '100.01',
				startDate: '2026-03-15',
				endDate: '2026-09-15'
			})
		).toBe(600.06);
	});

	test('a total cost takes precedence over the monthly cost', () => {
		expect(
			effectiveTermCost({
				totalCost: '1300',
				monthlyCost: '100',
				startDate: '2024-01-01',
				endDate: '2025-01-01'
			})
		).toBe(1300);
	});

	test('a monthly cost without an end date has no premium yet', () => {
		expect(
			effectiveTermCost({
				totalCost: '0',
				monthlyCost: '100',
				startDate: '2024-01-01',
				endDate: ''
			})
		).toBe(0);
	});
});
