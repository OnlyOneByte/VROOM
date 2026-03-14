/**
 * Property-Based Tests for Insurance Utility Functions (v2 flat term fields)
 *
 * Property 11: Policy active/inactive grouping
 * Property 12: Expiration alert computation
 * Property 13: Term history ordering
 * Property 14: Renew pre-fill from previous term
 */

import { describe, expect, test } from 'vitest';
import fc from 'fast-check';
import type { InsuranceTerm, InsurancePolicy } from '$lib/types';
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

/** Generate a flat InsuranceTerm with valid startDate < endDate */
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

/** Generate an InsurancePolicy with random isActive and 1–5 terms */
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

// ---------------------------------------------------------------------------
// Property 11: Policy active/inactive grouping
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
});

// ---------------------------------------------------------------------------
// Property 13: Term history ordering
// ---------------------------------------------------------------------------
describe('Property 13: Term history ordering', () => {
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

// ---------------------------------------------------------------------------
// Property 14: Renew pre-fill from previous term (v2 flat fields)
// ---------------------------------------------------------------------------
describe('Property 14: Renew pre-fill from previous term', () => {
	test('prefillFromPreviousTerm copies flat fields from the term', () => {
		fc.assert(
			fc.property(arbInsuranceTerm, term => {
				const prefilled = prefillFromPreviousTerm(term);

				// Flat fields should be copied
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
});
