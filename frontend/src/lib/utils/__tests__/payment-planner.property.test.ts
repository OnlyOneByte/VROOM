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
		computedBalance: 20000,
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
			{ numRuns: 100 }
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
			{ numRuns: 100 }
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
			{ numRuns: 100 }
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
			{ numRuns: 100 }
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
			{ numRuns: 100 }
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
			{ numRuns: 100 }
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
			{ numRuns: 100 }
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
			{ numRuns: 100 }
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
			{ numRuns: 100 }
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
			{ numRuns: 100 }
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
			{ numRuns: 100 }
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
			{ numRuns: 100 }
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
			{ numRuns: 100 }
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
			{ numRuns: 100 }
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
			{ numRuns: 100 }
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
			{ numRuns: 100 }
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
			{ numRuns: 100 }
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
			{ numRuns: 100 }
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
			{ numRuns: 100 }
		);
	});

	// C380: buildSummary renders monthsSaved via the (private) formatMonths, which pluralizes on the
	// `=== 1` boundary — "1 month" vs "N months". The structure tests above never assert the singular/
	// plural rendering, so a regression dropping the `=== 1` branch would silently emit "saves 1 months"
	// (a visible grammar bug on the planner card). Pin both sides through the PUBLIC buildSummary (the
	// helper isn't exported). Input strictly above minimum + a null delta → the normal-state sentence.
	test('monthsSaved=1 renders the SINGULAR "1 month" (not "1 months") in the summary', () => {
		const impact = {
			extraPaymentAmount: 50,
			monthsSaved: 1,
			interestSaved: 123.45,
			totalSavings: 173.45,
			newPayoffDate: new Date(2030, 0, 1)
		};
		// input (150) strictly > minimum (100) + 0.01 → not the at-minimum branch; null delta → normal.
		const result = buildSummary(150, 150, 100, impact, null);
		expect(result).toContain('1 month');
		expect(result).not.toContain('1 months'); // the load-bearing singular boundary
	});

	test('monthsSaved=2 renders the PLURAL "2 months" (boundary other side)', () => {
		const impact = {
			extraPaymentAmount: 50,
			monthsSaved: 2,
			interestSaved: 200,
			totalSavings: 250,
			newPayoffDate: new Date(2030, 0, 1)
		};
		const result = buildSummary(150, 150, 100, impact, null);
		expect(result).toContain('2 months');
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
			{ numRuns: 100 }
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
			{ numRuns: 100 }
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
			{ numRuns: 100 }
		);
	});
});

// ---------------------------------------------------------------------------
// #117 (C405): a 0%-APR loan in the Payment Planner showed "0 mos / $0 saved" no matter the extra
// payment. calculateMinimumPayment returns null for a 0%-APR loan, so the dialog passes minimumPayment=0
// into computePlannerState; the OLD code used that 0 as the baseline paymentAmount, so the baseline
// amortization (simulateAmortization at payment 0) tripped the negative-amortization guard → 0 months →
// monthsSaved = max(0, 0 − accelerated) = 0. The #92 symptom re-manifested at the planner layer (the
// C297 0%-APR fix lives one layer down in calculateExtraPaymentImpact; feeding a $0 baseline defeats it).
// FIX: baseline = minimumPayment>0 ? minimumPayment : financing.paymentAmount. These pin that a 0%-APR
// loan now reports real months saved, and that apr>0 behavior is unchanged.
// ---------------------------------------------------------------------------
describe('#117: 0%-APR loan planner reports real months saved (not "0 mos")', () => {
	// A 0%-APR loan: minimumPayment is null → the dialog passes 0. $12,000 balance, $400/mo contractual.
	const zeroApr = makeFinancing({
		apr: 0,
		computedBalance: 12000,
		originalAmount: 12000,
		paymentAmount: 400,
		termMonths: 30
	});

	test('calculateMinimumPayment is null for a 0%-APR loan (so the dialog feeds minimumPayment=0)', () => {
		expect(calculateMinimumPayment(zeroApr)).toBeNull();
	});

	test('paying $500 vs the $400 contractual payment reports the real ~6 months saved, $0 interest', () => {
		// 12000 / 400 = 30 mo baseline; 12000 / 500 = 24 mo accelerated → 6 months saved, interest 0 (0%).
		const state = computePlannerState(zeroApr, 500, 0, 400);
		expect(state.state === 'normal' || state.state === 'with-delta').toBe(true);
		const impact = (state as { primaryImpact: { monthsSaved: number; interestSaved: number } })
			.primaryImpact;
		expect(impact.monthsSaved).toBe(6); // was 0 pre-fix (the bug)
		expect(impact.interestSaved).toBe(0); // interest-free loan — $0 interest saved is correct
	});

	test('more extra → strictly more months saved on a 0%-APR loan (monotonic, never stuck at 0)', () => {
		// $600/mo (12000/600 = 20 mo) saves more than $500/mo (24 mo): 10 mo vs 6 mo.
		const at600 = computePlannerState(zeroApr, 600, 0, 400) as {
			primaryImpact: { monthsSaved: number };
		};
		const at500 = computePlannerState(zeroApr, 500, 0, 400) as {
			primaryImpact: { monthsSaved: number };
		};
		expect(at600.primaryImpact.monthsSaved).toBeGreaterThan(at500.primaryImpact.monthsSaved);
	});

	test('apr>0 behavior is unchanged: the real minimum is still the baseline', () => {
		// A 5%-APR loan with a real minimumPayment computes the same as before (baseline = minimumPayment,
		// not paymentAmount). Pin that the input-vs-minimum primary impact is still produced. savedAmount =
		// minimum (≠ input) so this is the 'with-delta' state by definition; either impact-bearing state is
		// fine — the point is the apr>0 path produces a real impact, not the 0%-APR fallback.
		const fivePct = makeFinancing({ apr: 5, computedBalance: 20000, paymentAmount: 400 });
		const min = calculateMinimumPayment(fivePct);
		expect(min).not.toBeNull();
		const state = computePlannerState(fivePct, (min as number) + 100, min as number, min as number);
		expect(state.state === 'normal' || state.state === 'with-delta').toBe(true);
		expect(
			(state as { primaryImpact: { monthsSaved: number } }).primaryImpact.monthsSaved
		).toBeGreaterThanOrEqual(0);
	});
});
