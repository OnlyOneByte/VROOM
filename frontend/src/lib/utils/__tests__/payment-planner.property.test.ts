/**
 * Property-Based Tests for Payment Planner
 *
 * Property 1: Planner State Classification
 * For any valid financing, minimum, input, and saved amounts: the four states
 * (below-minimum, at-minimum, normal, with-delta) are exhaustive and mutually exclusive.
 *
 * **Validates: Requirements 3.1, 3.3, 3.4, 4.1, 4.3**
 */

import { describe, expect, test } from 'vitest';
import fc from 'fast-check';
import type { VehicleFinancing } from '$lib/types';
import { computePlannerState, canSave, buildSummary } from '$lib/utils/payment-planner';
import { calculateMinimumPayment } from '$lib/utils/financing-calculations';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFinancing(overrides: Partial<VehicleFinancing> = {}): VehicleFinancing {
	return {
		id: 'fin-1',
		vehicleId: 'vehicle-1',
		financingType: 'loan',
		provider: 'Test Bank',
		originalAmount: 20000,
		currentBalance: 20000,
		apr: 5.0,
		termMonths: 60,
		startDate: '2024-01-01',
		paymentAmount: 400,
		paymentFrequency: 'monthly',
		isActive: true,
		createdAt: '2024-01-01T00:00:00.000Z',
		updatedAt: '2024-01-01T00:00:00.000Z',
		...overrides
	};
}

// ---------------------------------------------------------------------------
// Arbitraries — use integer cents to avoid floating-point precision issues
// ---------------------------------------------------------------------------

/** Minimum payment in cents (5000–200000 → $50–$2000) */
const arbMinimumCents = fc.integer({ min: 5000, max: 200_000 });

/** Arbitrary dollar amount in cents (1–1_000_000 → $0.01–$10_000) */
const arbDollarCents = fc.integer({ min: 1, max: 1_000_000 });

/** Positive gap in cents (at least 2 cents to stay outside $0.01 tolerance) */
const arbGapCents = fc.integer({ min: 2, max: 50_000 });

// ---------------------------------------------------------------------------
// Property 1: Planner State Classification
//
// The four states (below-minimum, at-minimum, normal, with-delta) are
// exhaustive and mutually exclusive for any valid inputs.
//
// **Validates: Requirements 3.1, 3.3, 3.4, 4.1, 4.3**
// ---------------------------------------------------------------------------
describe('Property 1: Planner State Classification', () => {
	test('input below minimum produces below-minimum state', () => {
		fc.assert(
			fc.property(
				arbMinimumCents,
				arbDollarCents,
				arbGapCents,
				(minCents, savedCents, gapCents) => {
					// Input at least 2 cents below minimum (outside $0.01 tolerance)
					const inputCents = minCents - gapCents;
					if (inputCents <= 0) return;

					const minimum = minCents / 100;
					const input = inputCents / 100;
					const saved = savedCents / 100;

					const result = computePlannerState(
						makeFinancing({ paymentAmount: saved }),
						input,
						minimum,
						saved
					);

					expect(result.state).toBe('below-minimum');
				}
			),
			{ numRuns: 200 }
		);
	});

	test('input exactly at minimum produces at-minimum state', () => {
		fc.assert(
			fc.property(arbMinimumCents, arbDollarCents, (minCents, savedCents) => {
				// Input exactly equals minimum — always within $0.01 tolerance
				const minimum = minCents / 100;
				const saved = savedCents / 100;

				const result = computePlannerState(
					makeFinancing({ paymentAmount: saved }),
					minimum,
					minimum,
					saved
				);

				expect(result.state).toBe('at-minimum');
			}),
			{ numRuns: 200 }
		);
	});

	test('input above minimum with input === saved produces normal state', () => {
		fc.assert(
			fc.property(arbMinimumCents, arbGapCents, (minCents, extraCents) => {
				// Input clearly above minimum, saved exactly equals input
				const inputCents = minCents + extraCents;
				const input = inputCents / 100;
				const minimum = minCents / 100;

				const result = computePlannerState(
					makeFinancing({ paymentAmount: input }),
					input,
					minimum,
					input // saved === input → |diff| = 0 ≤ 0.01
				);

				expect(result.state).toBe('normal');
				if (result.state === 'normal') {
					expect(result.primaryImpact).toBeDefined();
				}
			}),
			{ numRuns: 200 }
		);
	});

	test('input above minimum with |input - saved| > $0.01 produces with-delta state', () => {
		fc.assert(
			fc.property(arbMinimumCents, arbGapCents, arbGapCents, (minCents, extraCents, deltaCents) => {
				// Input clearly above minimum
				const inputCents = minCents + extraCents;
				// Saved differs from input by at least 2 cents (outside $0.01 tolerance)
				const savedCents = inputCents + deltaCents;

				const input = inputCents / 100;
				const minimum = minCents / 100;
				const saved = savedCents / 100;

				const result = computePlannerState(
					makeFinancing({ paymentAmount: saved }),
					input,
					minimum,
					saved
				);

				expect(result.state).toBe('with-delta');
				if (result.state === 'with-delta') {
					expect(result.primaryImpact).toBeDefined();
					expect(result.secondaryDelta).toBeDefined();
				}
			}),
			{ numRuns: 200 }
		);
	});

	test('every valid input maps to exactly one of the four states (exhaustive & mutually exclusive)', () => {
		fc.assert(
			fc.property(
				arbMinimumCents,
				arbDollarCents,
				arbDollarCents,
				(minCents, inputCents, savedCents) => {
					if (inputCents <= 0 || minCents <= 0) return;

					const minimum = minCents / 100;
					const input = inputCents / 100;
					const saved = savedCents / 100;

					const result = computePlannerState(
						makeFinancing({ paymentAmount: saved }),
						input,
						minimum,
						saved
					);

					const validStates = ['below-minimum', 'at-minimum', 'normal', 'with-delta'];
					expect(validStates).toContain(result.state);

					// Verify mutual exclusivity: each state has its own unique fields
					switch (result.state) {
						case 'below-minimum':
							expect(result).toHaveProperty('error');
							expect(result).not.toHaveProperty('primaryImpact');
							expect(result).not.toHaveProperty('secondaryDelta');
							expect(result).not.toHaveProperty('message');
							break;
						case 'at-minimum':
							expect(result).toHaveProperty('message');
							expect(result).not.toHaveProperty('primaryImpact');
							expect(result).not.toHaveProperty('secondaryDelta');
							expect(result).not.toHaveProperty('error');
							break;
						case 'normal':
							expect(result).toHaveProperty('primaryImpact');
							expect(result).not.toHaveProperty('secondaryDelta');
							expect(result).not.toHaveProperty('error');
							expect(result).not.toHaveProperty('message');
							break;
						case 'with-delta':
							expect(result).toHaveProperty('primaryImpact');
							expect(result).toHaveProperty('secondaryDelta');
							expect(result).not.toHaveProperty('error');
							expect(result).not.toHaveProperty('message');
							break;
					}
				}
			),
			{ numRuns: 200 }
		);
	});

	test('state classification matches boundary conditions for any minimum', () => {
		fc.assert(
			fc.property(arbMinimumCents, minCents => {
				if (minCents <= 200) return; // need room for below-minimum test

				const minimum = minCents / 100;
				const financing = makeFinancing();

				// Below minimum: clearly below
				const belowInput = (minCents - 200) / 100;
				const belowResult = computePlannerState(financing, belowInput, minimum, minimum);
				expect(belowResult.state).toBe('below-minimum');

				// At minimum: input = minimum exactly
				const atResult = computePlannerState(financing, minimum, minimum, minimum);
				expect(atResult.state).toBe('at-minimum');

				// Above minimum, saved = input (normal)
				const aboveInput = (minCents + 5000) / 100;
				const normalResult = computePlannerState(financing, aboveInput, minimum, aboveInput);
				expect(normalResult.state).toBe('normal');

				// Above minimum, saved ≠ input (with-delta)
				const deltaSaved = (minCents + 10000) / 100;
				const deltaResult = computePlannerState(financing, aboveInput, minimum, deltaSaved);
				expect(deltaResult.state).toBe('with-delta');
			}),
			{ numRuns: 200 }
		);
	});
});

// ---------------------------------------------------------------------------
// Property 2: Impact Monotonicity
//
// For any two amounts a > b > minimum against the same financing,
// monthsSaved(a) ≥ monthsSaved(b) and interestSaved(a) ≥ interestSaved(b).
// Paying more never results in worse outcomes.
//
// **Validates: Requirement 3.1**
// ---------------------------------------------------------------------------
describe('Property 2: Impact Monotonicity', () => {
	/** Minimum payment in cents (5000–100000 → $50–$1000) */
	const arbMinCents = fc.integer({ min: 5000, max: 100_000 });

	/**
	 * Gap above minimum in cents. Both amounts are above minimum:
	 *   b = minimum + gapB
	 *   a = b + extraA  (so a > b > minimum)
	 *
	 * Keep gaps modest to stay within realistic payment ranges.
	 */
	const arbGapB = fc.integer({ min: 1, max: 200_000 });
	const arbExtraA = fc.integer({ min: 1, max: 200_000 });

	test('monthsSaved(a) ≥ monthsSaved(b) when a > b > minimum', () => {
		fc.assert(
			fc.property(arbMinCents, arbGapB, arbExtraA, (minCents, gapBCents, extraACents) => {
				const minimum = minCents / 100;
				const b = (minCents + gapBCents) / 100;
				const a = (minCents + gapBCents + extraACents) / 100;

				// Both amounts above minimum, a > b
				const financing = makeFinancing({ paymentAmount: minimum });

				const resultA = computePlannerState(financing, a, minimum, a);
				const resultB = computePlannerState(financing, b, minimum, b);

				// Both should be 'normal' (input === saved, both above minimum)
				if (resultA.state !== 'normal' || resultB.state !== 'normal') return;

				expect(resultA.primaryImpact.monthsSaved).toBeGreaterThanOrEqual(
					resultB.primaryImpact.monthsSaved
				);
			}),
			{ numRuns: 200 }
		);
	});

	test('interestSaved(a) ≥ interestSaved(b) when a > b > minimum', () => {
		fc.assert(
			fc.property(arbMinCents, arbGapB, arbExtraA, (minCents, gapBCents, extraACents) => {
				const minimum = minCents / 100;
				const b = (minCents + gapBCents) / 100;
				const a = (minCents + gapBCents + extraACents) / 100;

				const financing = makeFinancing({ paymentAmount: minimum });

				const resultA = computePlannerState(financing, a, minimum, a);
				const resultB = computePlannerState(financing, b, minimum, b);

				if (resultA.state !== 'normal' || resultB.state !== 'normal') return;

				expect(resultA.primaryImpact.interestSaved).toBeGreaterThanOrEqual(
					resultB.primaryImpact.interestSaved
				);
			}),
			{ numRuns: 200 }
		);
	});
});

// ---------------------------------------------------------------------------
// Property 3: Secondary Delta Correctness and Direction
//
// For any input amount that differs from the saved amount by more than $0.01
// (both above minimum), the secondary delta's monthsDelta equals
// primaryImpact(input).monthsSaved - primaryImpact(saved).monthsSaved,
// interestDelta equals primaryImpact(input).interestSaved -
// primaryImpact(saved).interestSaved, and direction is 'better' when
// input > saved, 'worse' when input < saved.
//
// **Validates: Requirements 3.3, 3.5, 3.6**
// ---------------------------------------------------------------------------
describe('Property 3: Secondary Delta Correctness and Direction', () => {
	/** Minimum payment in cents (5000–100000 → $50–$1000) */
	const arbMinCents = fc.integer({ min: 5000, max: 100_000 });

	/** Gap above minimum for input and saved (at least 1 cent above minimum) */
	const arbGapInput = fc.integer({ min: 1, max: 200_000 });
	const arbGapSaved = fc.integer({ min: 1, max: 200_000 });

	test('monthsDelta equals primaryImpact(input).monthsSaved - primaryImpact(saved).monthsSaved', () => {
		fc.assert(
			fc.property(
				arbMinCents,
				arbGapInput,
				arbGapSaved,
				(minCents, gapInputCents, gapSavedCents) => {
					const inputCents = minCents + gapInputCents;
					const savedCents = minCents + gapSavedCents;

					// Both above minimum and differ by more than 1 cent ($0.01)
					if (Math.abs(inputCents - savedCents) <= 1) return;

					const minimum = minCents / 100;
					const input = inputCents / 100;
					const saved = savedCents / 100;

					const financing = makeFinancing({ paymentAmount: saved });

					// Get with-delta result for input vs saved
					const withDeltaResult = computePlannerState(financing, input, minimum, saved);
					if (withDeltaResult.state !== 'with-delta') return;

					// Get normal result for saved (saved as both input and saved → normal state)
					const savedResult = computePlannerState(financing, saved, minimum, saved);
					if (savedResult.state !== 'normal') return;

					expect(withDeltaResult.secondaryDelta.monthsDelta).toBe(
						withDeltaResult.primaryImpact.monthsSaved - savedResult.primaryImpact.monthsSaved
					);
				}
			),
			{ numRuns: 200 }
		);
	});

	test('interestDelta equals primaryImpact(input).interestSaved - primaryImpact(saved).interestSaved', () => {
		fc.assert(
			fc.property(
				arbMinCents,
				arbGapInput,
				arbGapSaved,
				(minCents, gapInputCents, gapSavedCents) => {
					const inputCents = minCents + gapInputCents;
					const savedCents = minCents + gapSavedCents;

					if (Math.abs(inputCents - savedCents) <= 1) return;

					const minimum = minCents / 100;
					const input = inputCents / 100;
					const saved = savedCents / 100;

					const financing = makeFinancing({ paymentAmount: saved });

					const withDeltaResult = computePlannerState(financing, input, minimum, saved);
					if (withDeltaResult.state !== 'with-delta') return;

					const savedResult = computePlannerState(financing, saved, minimum, saved);
					if (savedResult.state !== 'normal') return;

					expect(withDeltaResult.secondaryDelta.interestDelta).toBe(
						withDeltaResult.primaryImpact.interestSaved - savedResult.primaryImpact.interestSaved
					);
				}
			),
			{ numRuns: 200 }
		);
	});

	test('direction is "better" when input > saved, "worse" when input < saved', () => {
		fc.assert(
			fc.property(
				arbMinCents,
				arbGapInput,
				arbGapSaved,
				(minCents, gapInputCents, gapSavedCents) => {
					const inputCents = minCents + gapInputCents;
					const savedCents = minCents + gapSavedCents;

					if (Math.abs(inputCents - savedCents) <= 1) return;

					const minimum = minCents / 100;
					const input = inputCents / 100;
					const saved = savedCents / 100;

					const financing = makeFinancing({ paymentAmount: saved });

					const result = computePlannerState(financing, input, minimum, saved);
					if (result.state !== 'with-delta') return;

					if (input > saved) {
						expect(result.secondaryDelta.direction).toBe('better');
					} else {
						expect(result.secondaryDelta.direction).toBe('worse');
					}
				}
			),
			{ numRuns: 200 }
		);
	});
});

// ---------------------------------------------------------------------------
// Property 4: Save Guard Correctness
//
// Save enabled iff: input ≥ minimum AND |input - saved| > 0.01 AND not saving.
// All three conditions must hold simultaneously.
//
// **Validates: Requirements 4.1, 4.4, 5.1**
// ---------------------------------------------------------------------------
describe('Property 4: Save Guard Correctness', () => {
	/** Minimum payment in cents (5000–200000 → $50–$2000) */
	const arbMinCents = fc.integer({ min: 5000, max: 200_000 });

	/** Gap in cents for amounts above minimum (at least 2 cents to clear $0.01 tolerance) */
	const arbAboveGapCents = fc.integer({ min: 2, max: 200_000 });

	/** Gap in cents for amounts below minimum (at least 2 cents below tolerance) */
	const arbBelowGapCents = fc.integer({ min: 3, max: 50_000 });

	/** Delta in cents between input and saved (at least 2 cents to exceed $0.01) */
	const arbDeltaCents = fc.integer({ min: 2, max: 200_000 });

	test('input below minimum → canSave returns false regardless of other params', () => {
		fc.assert(
			fc.property(
				arbMinCents,
				arbBelowGapCents,
				arbMinCents,
				fc.boolean(),
				(minCents, belowGapCents, savedCents, isSaving) => {
					// Input clearly below minimum (beyond tolerance)
					const inputCents = minCents - belowGapCents;
					if (inputCents <= 0) return;

					const input = inputCents / 100;
					const minimum = minCents / 100;
					const saved = savedCents / 100;

					expect(canSave(input, minimum, saved, isSaving)).toBe(false);
				}
			),
			{ numRuns: 200 }
		);
	});

	test('|input - saved| ≤ 0.01 → canSave returns false when input equals saved', () => {
		fc.assert(
			fc.property(
				arbMinCents,
				arbAboveGapCents,
				fc.boolean(),
				(minCents, aboveGapCents, isSaving) => {
					// Input above minimum, saved exactly equals input (delta = 0)
					const inputCents = minCents + aboveGapCents;

					const input = inputCents / 100;
					const minimum = minCents / 100;
					const saved = input; // exactly equal → |diff| = 0 ≤ 0.01

					expect(canSave(input, minimum, saved, isSaving)).toBe(false);
				}
			),
			{ numRuns: 200 }
		);
	});

	test('isSaving is true → canSave returns false regardless of other params', () => {
		fc.assert(
			fc.property(
				arbMinCents,
				arbAboveGapCents,
				arbDeltaCents,
				(minCents, aboveGapCents, deltaCents) => {
					// Input above minimum, saved differs by more than $0.01
					const inputCents = minCents + aboveGapCents;
					const savedCents = inputCents + deltaCents;

					const input = inputCents / 100;
					const minimum = minCents / 100;
					const saved = savedCents / 100;

					expect(canSave(input, minimum, saved, true)).toBe(false);
				}
			),
			{ numRuns: 200 }
		);
	});

	test('all three conditions met → canSave returns true', () => {
		fc.assert(
			fc.property(
				arbMinCents,
				arbAboveGapCents,
				arbDeltaCents,
				(minCents, aboveGapCents, deltaCents) => {
					// input ≥ minimum
					const inputCents = minCents + aboveGapCents;
					// |input - saved| > 0.01 (at least 2 cents apart)
					const savedCents = inputCents + deltaCents;

					const input = inputCents / 100;
					const minimum = minCents / 100;
					const saved = savedCents / 100;

					// All three conditions: input ≥ min, |input - saved| > 0.01, !isSaving
					expect(canSave(input, minimum, saved, false)).toBe(true);
				}
			),
			{ numRuns: 200 }
		);
	});

	test('each condition is individually necessary (removing any one makes canSave false)', () => {
		fc.assert(
			fc.property(
				arbMinCents,
				arbAboveGapCents,
				arbDeltaCents,
				(minCents, aboveGapCents, deltaCents) => {
					const inputCents = minCents + aboveGapCents;
					const savedCents = inputCents + deltaCents;

					const input = inputCents / 100;
					const minimum = minCents / 100;
					const saved = savedCents / 100;

					// Baseline: all conditions met → true
					expect(canSave(input, minimum, saved, false)).toBe(true);

					// Break condition 1: input below minimum
					const belowInput = (minCents - 300) / 100; // 3 cents below, past tolerance
					if (belowInput > 0) {
						expect(canSave(belowInput, minimum, saved, false)).toBe(false);
					}

					// Break condition 2: |input - saved| ≤ 0.01
					expect(canSave(input, minimum, input, false)).toBe(false);

					// Break condition 3: isSaving = true
					expect(canSave(input, minimum, saved, true)).toBe(false);
				}
			),
			{ numRuns: 200 }
		);
	});
});

// ---------------------------------------------------------------------------
// Property 5: Save Idempotency
//
// After a successful save, savedAmount = inputAmount, state transitions from
// with-delta to normal, Save button becomes disabled.
//
// **Validates: Requirements 5.2, 5.3**
// ---------------------------------------------------------------------------
describe('Property 5: Save Idempotency', () => {
	/** Minimum payment in cents (5000–200000 → $50–$2000) */
	const arbMinCents = fc.integer({ min: 5000, max: 200_000 });

	/** Gap above minimum in cents (at least 2 cents to clear $0.01 tolerance) */
	const arbAboveGapCents = fc.integer({ min: 2, max: 200_000 });

	/** Delta between input and saved in cents (at least 2 cents apart) */
	const arbDeltaCents = fc.integer({ min: 2, max: 200_000 });

	test('after save, computePlannerState with input as both input AND saved returns "normal" (not "with-delta")', () => {
		fc.assert(
			fc.property(
				arbMinCents,
				arbAboveGapCents,
				arbDeltaCents,
				(minCents, aboveGapCents, deltaCents) => {
					const inputCents = minCents + aboveGapCents;
					// Before save: saved differs from input (would be with-delta)
					const oldSavedCents = inputCents + deltaCents;

					const input = inputCents / 100;
					const minimum = minCents / 100;
					const oldSaved = oldSavedCents / 100;

					const financing = makeFinancing({ paymentAmount: oldSaved });

					// Pre-save: should be with-delta
					const preSave = computePlannerState(financing, input, minimum, oldSaved);
					expect(preSave.state).toBe('with-delta');

					// Post-save: savedAmount = inputAmount → should be normal
					const postSave = computePlannerState(financing, input, minimum, input);
					expect(postSave.state).toBe('normal');
				}
			),
			{ numRuns: 200 }
		);
	});

	test('after save, canSave returns false (|input - input| = 0 ≤ 0.01)', () => {
		fc.assert(
			fc.property(
				arbMinCents,
				arbAboveGapCents,
				arbDeltaCents,
				(minCents, aboveGapCents, _deltaCents) => {
					const inputCents = minCents + aboveGapCents;
					const input = inputCents / 100;
					const minimum = minCents / 100;

					// After save: savedAmount = inputAmount, not saving
					expect(canSave(input, minimum, input, false)).toBe(false);
				}
			),
			{ numRuns: 200 }
		);
	});
});

// ---------------------------------------------------------------------------
// Property 6: Summary Sentence Consistency
//
// Summary sentence matches the current planner state:
//   at-minimum → minimum message
//   normal → savings vs minimum
//   with-delta → savings + delta
//
// **Validates: Requirements 7.1, 7.2, 7.3**
// ---------------------------------------------------------------------------
describe('Property 6: Summary Sentence Consistency', () => {
	/** Minimum payment in cents (5000–100000 → $50–$1000) */
	const arbMinCents = fc.integer({ min: 5000, max: 100_000 });

	/** Gap above minimum in cents */
	const arbAboveGapCents = fc.integer({ min: 2, max: 200_000 });

	/** Delta between input and saved in cents (at least 2 cents apart) */
	const arbDeltaCents = fc.integer({ min: 2, max: 200_000 });

	test('at-minimum: buildSummary returns the minimum message', () => {
		fc.assert(
			fc.property(arbMinCents, minCents => {
				const minimum = minCents / 100;

				// At minimum: input ≈ minimum, no primary impact needed for this branch
				const dummyImpact = {
					extraPaymentAmount: 0,
					monthsSaved: 0,
					interestSaved: 0,
					totalSavings: 0,
					newPayoffDate: new Date()
				};
				const result = buildSummary(minimum, minimum, minimum, dummyImpact, null);

				expect(result).toBe('This is the minimum payment. No extra savings.');
			}),
			{ numRuns: 200 }
		);
	});

	test('normal state (no delta): summary contains "Your current payment" and "vs the minimum"', () => {
		fc.assert(
			fc.property(arbMinCents, arbAboveGapCents, (minCents, aboveGapCents) => {
				const inputCents = minCents + aboveGapCents;
				const input = inputCents / 100;
				const minimum = minCents / 100;

				const financing = makeFinancing({ paymentAmount: input });
				const state = computePlannerState(financing, input, minimum, input);
				if (state.state !== 'normal') return;

				const result = buildSummary(input, input, minimum, state.primaryImpact, null);

				expect(result).toContain('Your current payment');
				expect(result).toContain('vs the minimum');
			}),
			{ numRuns: 200 }
		);
	});

	test('with-delta state: summary contains "vs minimum" and "than your current"', () => {
		fc.assert(
			fc.property(
				arbMinCents,
				arbAboveGapCents,
				arbDeltaCents,
				(minCents, aboveGapCents, deltaCents) => {
					const inputCents = minCents + aboveGapCents;
					const savedCents = inputCents + deltaCents;

					const input = inputCents / 100;
					const minimum = minCents / 100;
					const saved = savedCents / 100;

					const financing = makeFinancing({ paymentAmount: saved });
					const state = computePlannerState(financing, input, minimum, saved);
					if (state.state !== 'with-delta') return;

					const result = buildSummary(
						input,
						saved,
						minimum,
						state.primaryImpact,
						state.secondaryDelta
					);

					expect(result).toContain('vs minimum');
					expect(result).toContain('than your current');
				}
			),
			{ numRuns: 200 }
		);
	});
});

// ---------------------------------------------------------------------------
// Property 7: Non-Loan Financing Guard
//
// For any financing where financingType ≠ 'loan', calculateMinimumPayment
// returns null, meaning the planner can't compute meaningful state.
//
// **Validates: Requirement 8.1**
// ---------------------------------------------------------------------------
describe('Property 7: Non-Loan Financing Guard', () => {
	const arbNonLoanType = fc.constantFrom('lease' as const, 'own' as const);

	test('calculateMinimumPayment returns null for non-loan financing', () => {
		fc.assert(
			fc.property(arbNonLoanType, financingType => {
				const financing = makeFinancing({ financingType });

				const result = calculateMinimumPayment(financing);

				expect(result).toBeNull();
			}),
			{ numRuns: 200 }
		);
	});
});
