/**
 * Property-Based Tests for Insurance Utility Functions
 *
 * Property 11: Policy active/inactive grouping
 * Property 12: Expiration alert computation
 * Property 13: Term history ordering
 * Property 14: Renew pre-fill from previous term
 */

import { describe, expect, test } from 'vitest';
import fc from 'fast-check';
import type { FinanceDetails, InsurancePolicy, PolicyDetails, PolicyTerm } from '$lib/types';
import {
	getDaysRemaining,
	getLatestTerm,
	groupPoliciesByActive,
	isExpiringSoon,
	prefillFromPreviousTerm,
	sortTermsByEndDateDesc
} from '$lib/utils/insurance';

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;

let idCounter = 0;

const arbPolicyDetails: fc.Arbitrary<PolicyDetails> = fc.record({
	policyNumber: fc.option(fc.string({ minLength: 1, maxLength: 20 }), { nil: undefined }),
	coverageDescription: fc.option(fc.string({ minLength: 1, maxLength: 50 }), { nil: undefined }),
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
	agentEmail: fc.option(fc.string({ minLength: 1, maxLength: 30 }), { nil: undefined })
});

const arbFinanceDetails: fc.Arbitrary<FinanceDetails> = fc.record({
	totalCost: fc.option(fc.double({ min: 0, max: 50000, noNaN: true, noDefaultInfinity: true }), {
		nil: undefined
	}),
	monthlyCost: fc.option(fc.double({ min: 0, max: 5000, noNaN: true, noDefaultInfinity: true }), {
		nil: undefined
	}),
	premiumFrequency: fc.option(fc.constantFrom('monthly', 'quarterly', 'annual'), {
		nil: undefined
	}),
	paymentAmount: fc.option(fc.double({ min: 0, max: 5000, noNaN: true, noDefaultInfinity: true }), {
		nil: undefined
	})
});

/** Generate a PolicyTerm with a valid startDate < endDate */
const arbPolicyTerm: fc.Arbitrary<PolicyTerm> = fc
	.record({
		startTs: fc.integer({ min: 946684800000, max: 2524608000000 }), // 2000–2050
		durationDays: fc.integer({ min: 1, max: 730 }),
		policyDetails: arbPolicyDetails,
		financeDetails: arbFinanceDetails
	})
	.map(({ startTs, durationDays, policyDetails, financeDetails }) => {
		idCounter++;
		const startDate = new Date(startTs).toISOString().split('T')[0] as string;
		const endDate = new Date(startTs + durationDays * DAY_MS).toISOString().split('T')[0] as string;
		return {
			id: `term-${idCounter}`,
			startDate,
			endDate,
			policyDetails,
			financeDetails
		};
	});

/** Generate an InsurancePolicy with random isActive and 1–5 terms */
const arbInsurancePolicy: fc.Arbitrary<InsurancePolicy> = fc
	.record({
		isActive: fc.boolean(),
		terms: fc.array(arbPolicyTerm, { minLength: 1, maxLength: 5 })
	})
	.map(({ isActive, terms }) => {
		idCounter++;
		return {
			id: `policy-${idCounter}`,
			company: `Company ${idCounter}`,
			isActive,
			terms,
			vehicleIds: [`vehicle-${idCounter}`],
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString()
		};
	});

// ---------------------------------------------------------------------------
// Property 11: Policy active/inactive grouping
//
// Partitioning policies by isActive produces correct groups with no missing
// policies.
//
// Feature: insurance-management, Property 11: Policy active/inactive grouping
// **Validates: Requirements 3.1**
// ---------------------------------------------------------------------------
describe('Property 11: Policy active/inactive grouping', () => {
	test('active group contains only isActive===true policies', () => {
		fc.assert(
			fc.property(fc.array(arbInsurancePolicy, { minLength: 0, maxLength: 20 }), policies => {
				const { active } = groupPoliciesByActive(policies);
				for (const policy of active) {
					expect(policy.isActive).toBe(true);
				}
			}),
			{ numRuns: 100 }
		);
	});

	test('inactive group contains only isActive===false policies', () => {
		fc.assert(
			fc.property(fc.array(arbInsurancePolicy, { minLength: 0, maxLength: 20 }), policies => {
				const { inactive } = groupPoliciesByActive(policies);
				for (const policy of inactive) {
					expect(policy.isActive).toBe(false);
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

// ---------------------------------------------------------------------------
// Property 12: Expiration alert computation
//
// Alert appears iff currentTermEnd within 30 days; daysRemaining equals
// ceil((currentTermEnd - now) / day).
//
// Feature: insurance-management, Property 12: Expiration alert computation
// **Validates: Requirements 3.4**
// ---------------------------------------------------------------------------
describe('Property 12: Expiration alert computation', () => {
	test('getDaysRemaining equals ceil((endDate - now) / dayMs)', () => {
		fc.assert(
			fc.property(fc.integer({ min: -365, max: 365 }), offsetDays => {
				const now = new Date();
				const endDate = new Date(now.getTime() + offsetDays * DAY_MS);
				const endDateStr = endDate.toISOString();

				const result = getDaysRemaining(endDateStr);
				const expected = Math.ceil((endDate.getTime() - now.getTime()) / DAY_MS);

				// Allow ±1 day tolerance due to sub-millisecond timing between
				// the Date construction above and the `new Date()` inside getDaysRemaining
				expect(Math.abs(result - expected)).toBeLessThanOrEqual(1);
			}),
			{ numRuns: 100 }
		);
	});

	test('isExpiringSoon returns true iff daysRemaining is in [0, threshold]', () => {
		fc.assert(
			fc.property(
				fc.integer({ min: -60, max: 60 }),
				fc.integer({ min: 1, max: 90 }),
				(offsetDays, threshold) => {
					const now = new Date();
					const endDate = new Date(now.getTime() + offsetDays * DAY_MS);
					const endDateStr = endDate.toISOString();

					const result = isExpiringSoon(endDateStr, threshold);
					const days = getDaysRemaining(endDateStr);

					if (days >= 0 && days <= threshold) {
						expect(result).toBe(true);
					} else {
						expect(result).toBe(false);
					}
				}
			),
			{ numRuns: 100 }
		);
	});

	test('isExpiringSoon defaults to 30-day threshold', () => {
		fc.assert(
			fc.property(fc.integer({ min: -60, max: 60 }), offsetDays => {
				const now = new Date();
				const endDate = new Date(now.getTime() + offsetDays * DAY_MS);
				const endDateStr = endDate.toISOString();

				const result = isExpiringSoon(endDateStr);
				const days = getDaysRemaining(endDateStr);

				if (days >= 0 && days <= 30) {
					expect(result).toBe(true);
				} else {
					expect(result).toBe(false);
				}
			}),
			{ numRuns: 100 }
		);
	});
});

// ---------------------------------------------------------------------------
// Property 13: Term history ordering
//
// Terms displayed in reverse chronological order by endDate.
//
// Feature: insurance-management, Property 13: Term history ordering
// **Validates: Requirements 3.5**
// ---------------------------------------------------------------------------
describe('Property 13: Term history ordering', () => {
	test('sortTermsByEndDateDesc returns terms in descending endDate order', () => {
		fc.assert(
			fc.property(fc.array(arbPolicyTerm, { minLength: 0, maxLength: 20 }), terms => {
				const sorted = sortTermsByEndDateDesc(terms);

				expect(sorted.length).toBe(terms.length);

				for (let i = 1; i < sorted.length; i++) {
					const prev = sorted[i - 1] as PolicyTerm;
					const curr = sorted[i] as PolicyTerm;
					expect(new Date(prev.endDate).getTime()).toBeGreaterThanOrEqual(
						new Date(curr.endDate).getTime()
					);
				}
			}),
			{ numRuns: 100 }
		);
	});

	test('sortTermsByEndDateDesc does not mutate the original array', () => {
		fc.assert(
			fc.property(fc.array(arbPolicyTerm, { minLength: 1, maxLength: 10 }), terms => {
				const original = [...terms];
				sortTermsByEndDateDesc(terms);

				expect(terms).toEqual(original);
			}),
			{ numRuns: 100 }
		);
	});

	test('sortTermsByEndDateDesc preserves all elements (no duplicates or losses)', () => {
		fc.assert(
			fc.property(fc.array(arbPolicyTerm, { minLength: 0, maxLength: 20 }), terms => {
				const sorted = sortTermsByEndDateDesc(terms);
				const inputIds = terms.map(t => t.id).sort();
				const sortedIds = sorted.map(t => t.id).sort();

				expect(sortedIds).toEqual(inputIds);
			}),
			{ numRuns: 100 }
		);
	});
});

// ---------------------------------------------------------------------------
// Property 14: Renew pre-fill from previous term
//
// Renew action produces a form pre-filled with latest term's policyDetails
// and financeDetails (deep equal).
//
// Feature: insurance-management, Property 14: Renew pre-fill from previous term
// **Validates: Requirements 3.6**
// ---------------------------------------------------------------------------
describe('Property 14: Renew pre-fill from previous term', () => {
	test('prefillFromPreviousTerm produces deep-equal copies of policyDetails and financeDetails', () => {
		fc.assert(
			fc.property(arbPolicyTerm, term => {
				const prefilled = prefillFromPreviousTerm(term);

				expect(prefilled.policyDetails).toEqual(term.policyDetails);
				expect(prefilled.financeDetails).toEqual(term.financeDetails);
			}),
			{ numRuns: 100 }
		);
	});

	test('prefillFromPreviousTerm returns independent copies (mutation does not affect original)', () => {
		fc.assert(
			fc.property(arbPolicyTerm, term => {
				const originalPolicyDetails = structuredClone(term.policyDetails);
				const originalFinanceDetails = structuredClone(term.financeDetails);

				const prefilled = prefillFromPreviousTerm(term);

				// Mutate the prefilled copy
				prefilled.policyDetails.policyNumber = 'MUTATED';
				prefilled.financeDetails.totalCost = 999999;

				// Original should be unchanged
				expect(term.policyDetails).toEqual(originalPolicyDetails);
				expect(term.financeDetails).toEqual(originalFinanceDetails);
			}),
			{ numRuns: 100 }
		);
	});

	test('getLatestTerm + prefillFromPreviousTerm: renew uses the latest term by endDate', () => {
		fc.assert(
			fc.property(fc.array(arbPolicyTerm, { minLength: 1, maxLength: 10 }), terms => {
				const latest = getLatestTerm(terms);
				expect(latest).toBeDefined();

				// Verify it actually has the max endDate
				for (const term of terms) {
					expect(new Date(latest!.endDate).getTime()).toBeGreaterThanOrEqual(
						new Date(term.endDate).getTime()
					);
				}

				const prefilled = prefillFromPreviousTerm(latest!);
				expect(prefilled.policyDetails).toEqual(latest!.policyDetails);
				expect(prefilled.financeDetails).toEqual(latest!.financeDetails);
			}),
			{ numRuns: 100 }
		);
	});
});
