import { describe, expect, test } from 'vitest';
import fc from 'fast-check';
import type { VehicleFinancing } from '$lib/types';
import { computePlannerState, canSave, buildSummary } from '$lib/utils/payment-planner';
import { calculateMinimumPayment } from '$lib/utils/financing-calculations';

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

const arbMinimumCents = fc.integer({ min: 5000, max: 200_000 });

const arbDollarCents = fc.integer({ min: 1, max: 1_000_000 });

const arbGapCents = fc.integer({ min: 2, max: 50_000 });

describe('Planner State Classification', () => {
	test('input below minimum produces below-minimum state', () => {
		fc.assert(
			fc.property(
				arbMinimumCents,
				arbDollarCents,
				arbGapCents,
				(minCents, savedCents, gapCents) => {
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
				const inputCents = minCents + extraCents;
				const input = inputCents / 100;
				const minimum = minCents / 100;

				const result = computePlannerState(
					makeFinancing({ paymentAmount: input }),
					input,
					minimum,
					input
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
				const inputCents = minCents + extraCents;
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
				if (minCents <= 200) return;

				const minimum = minCents / 100;
				const financing = makeFinancing();

				const belowInput = (minCents - 200) / 100;
				const belowResult = computePlannerState(financing, belowInput, minimum, minimum);
				expect(belowResult.state).toBe('below-minimum');

				const atResult = computePlannerState(financing, minimum, minimum, minimum);
				expect(atResult.state).toBe('at-minimum');

				const aboveInput = (minCents + 5000) / 100;
				const normalResult = computePlannerState(financing, aboveInput, minimum, aboveInput);
				expect(normalResult.state).toBe('normal');

				const deltaSaved = (minCents + 10000) / 100;
				const deltaResult = computePlannerState(financing, aboveInput, minimum, deltaSaved);
				expect(deltaResult.state).toBe('with-delta');
			}),
			{ numRuns: 100 }
		);
	});
});

describe('Impact Monotonicity', () => {
	const arbMinCents = fc.integer({ min: 5000, max: 100_000 });

	const arbGapB = fc.integer({ min: 1, max: 200_000 });
	const arbExtraA = fc.integer({ min: 1, max: 200_000 });

	test('monthsSaved(a) ≥ monthsSaved(b) when a > b > minimum', () => {
		fc.assert(
			fc.property(arbMinCents, arbGapB, arbExtraA, (minCents, gapBCents, extraACents) => {
				const minimum = minCents / 100;
				const b = (minCents + gapBCents) / 100;
				const a = (minCents + gapBCents + extraACents) / 100;

				const financing = makeFinancing({ paymentAmount: minimum });

				const resultA = computePlannerState(financing, a, minimum, a);
				const resultB = computePlannerState(financing, b, minimum, b);

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

describe('Secondary Delta Correctness and Direction', () => {
	const arbMinCents = fc.integer({ min: 5000, max: 100_000 });

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

					if (Math.abs(inputCents - savedCents) <= 1) return;

					const minimum = minCents / 100;
					const input = inputCents / 100;
					const saved = savedCents / 100;

					const financing = makeFinancing({ paymentAmount: saved });

					const withDeltaResult = computePlannerState(financing, input, minimum, saved);
					if (withDeltaResult.state !== 'with-delta') return;

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

describe('Save Guard Correctness', () => {
	const arbMinCents = fc.integer({ min: 5000, max: 200_000 });

	const arbAboveGapCents = fc.integer({ min: 2, max: 200_000 });

	const arbBelowGapCents = fc.integer({ min: 3, max: 50_000 });

	const arbDeltaCents = fc.integer({ min: 2, max: 200_000 });

	test('input below minimum → canSave returns false regardless of other params', () => {
		fc.assert(
			fc.property(
				arbMinCents,
				arbBelowGapCents,
				arbMinCents,
				fc.boolean(),
				(minCents, belowGapCents, savedCents, isSaving) => {
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
					const inputCents = minCents + aboveGapCents;

					const input = inputCents / 100;
					const minimum = minCents / 100;
					const saved = input;

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
					const inputCents = minCents + aboveGapCents;
					const savedCents = inputCents + deltaCents;

					const input = inputCents / 100;
					const minimum = minCents / 100;
					const saved = savedCents / 100;

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

					expect(canSave(input, minimum, saved, false)).toBe(true);

					const belowInput = (minCents - 300) / 100;
					if (belowInput > 0) {
						expect(canSave(belowInput, minimum, saved, false)).toBe(false);
					}

					expect(canSave(input, minimum, input, false)).toBe(false);

					expect(canSave(input, minimum, saved, true)).toBe(false);
				}
			),
			{ numRuns: 100 }
		);
	});
});

describe('Save Idempotency', () => {
	const arbMinCents = fc.integer({ min: 5000, max: 200_000 });

	const arbAboveGapCents = fc.integer({ min: 2, max: 200_000 });

	const arbDeltaCents = fc.integer({ min: 2, max: 200_000 });

	test('after save, computePlannerState with input as both input AND saved returns "normal" (not "with-delta")', () => {
		fc.assert(
			fc.property(
				arbMinCents,
				arbAboveGapCents,
				arbDeltaCents,
				(minCents, aboveGapCents, deltaCents) => {
					const inputCents = minCents + aboveGapCents;
					const oldSavedCents = inputCents + deltaCents;

					const input = inputCents / 100;
					const minimum = minCents / 100;
					const oldSaved = oldSavedCents / 100;

					const financing = makeFinancing({ paymentAmount: oldSaved });

					const preSave = computePlannerState(financing, input, minimum, oldSaved);
					expect(preSave.state).toBe('with-delta');

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

					expect(canSave(input, minimum, input, false)).toBe(false);
				}
			),
			{ numRuns: 100 }
		);
	});
});

describe('Summary Sentence Consistency', () => {
	const arbMinCents = fc.integer({ min: 5000, max: 100_000 });

	const arbAboveGapCents = fc.integer({ min: 2, max: 200_000 });

	const arbDeltaCents = fc.integer({ min: 2, max: 200_000 });

	test('at-minimum: buildSummary returns the minimum message', () => {
		fc.assert(
			fc.property(arbMinCents, minCents => {
				const minimum = minCents / 100;

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

	test('monthsSaved=1 renders the SINGULAR "1 month" (not "1 months") in the summary', () => {
		const impact = {
			extraPaymentAmount: 50,
			monthsSaved: 1,
			interestSaved: 123.45,
			totalSavings: 173.45,
			newPayoffDate: new Date(2030, 0, 1)
		};
		const result = buildSummary(150, 150, 100, impact, null);
		expect(result).toContain('1 month');
		expect(result).not.toContain('1 months');
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

describe('Non-Loan Financing Guard', () => {
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

describe('0%-APR loan planner reports real months saved (not "0 mos")', () => {
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
		const state = computePlannerState(zeroApr, 500, 0, 400);
		expect(state.state === 'normal' || state.state === 'with-delta').toBe(true);
		const impact = (state as { primaryImpact: { monthsSaved: number; interestSaved: number } })
			.primaryImpact;
		expect(impact.monthsSaved).toBe(6);
		expect(impact.interestSaved).toBe(0);
	});

	test('more extra → strictly more months saved on a 0%-APR loan (monotonic, never stuck at 0)', () => {
		const at600 = computePlannerState(zeroApr, 600, 0, 400) as {
			primaryImpact: { monthsSaved: number };
		};
		const at500 = computePlannerState(zeroApr, 500, 0, 400) as {
			primaryImpact: { monthsSaved: number };
		};
		expect(at600.primaryImpact.monthsSaved).toBeGreaterThan(at500.primaryImpact.monthsSaved);
	});

	test('apr>0 behavior is unchanged: the real minimum is still the baseline', () => {
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
