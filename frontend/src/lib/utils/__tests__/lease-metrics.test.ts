/**
 * Tests for calculateLeaseMetrics() — the lease mileage/excess-fee math behind
 * LeaseMetricsCard. Previously had ZERO coverage despite computing a real dollar
 * figure (projectedExcessFee = projectedExcessMiles × excessMileageFee) and dividing
 * mileageUsed / daysElapsed for the burn-rate projection — the same high-stakes
 * money-math class as the TCO zero-state (cycle 168) and financing 0%-APR (cycle 171)
 * pins. No product bug was found on read; these lock the contract so a refactor can't
 * reintroduce a divide-by-zero, a negative "miles remaining", or a phantom excess fee.
 */

import { describe, expect, test } from 'vitest';
import fc from 'fast-check';
import type { VehicleFinancing } from '$lib/types';
import {
	calculateLeaseMetrics,
	calculateLeaseOverage,
	leaseTotalMileageAllowance,
	resolveCurrentOdometer
} from '$lib/utils/financing-calculations';

// Build a valid lease. Dates are expressed as offsets from a fixed "now" anchor the
// caller passes, so tests are deterministic regardless of the wall clock: startDate is
// `monthsAgo` before today and the term runs `termMonths` from start.
function isoDaysFromNow(days: number): string {
	const d = new Date();
	d.setDate(d.getDate() + days);
	return d.toISOString().slice(0, 10);
}

function makeLease(overrides: Partial<VehicleFinancing> = {}): VehicleFinancing {
	return {
		id: 'fin-lease-1',
		vehicleId: 'vehicle-1',
		financingType: 'lease',
		provider: 'Test Leasing',
		originalAmount: 30000,
		computedBalance: 30000,
		apr: 4.0,
		termMonths: 36,
		startDate: isoDaysFromNow(-365), // one year into the lease by default
		endDate: isoDaysFromNow(365 * 2), // two years remaining
		paymentAmount: 400,
		paymentFrequency: 'monthly',
		isActive: true,
		// ANNUAL mileage limit (#64, C198): the field is per-year, so on this 36-mo lease the WHOLE-LEASE
		// allowance is 12000 × 3 = 36000. (The pre-fix code + these tests treated the annual number AS the
		// total, over-reporting excess ~3x; the realistic 12000/yr here makes the term-scaled total 36000.)
		mileageLimit: 12000,
		excessMileageFee: 0.25,
		createdAt: '2024-01-01T00:00:00.000Z',
		updatedAt: '2024-01-01T00:00:00.000Z',
		...overrides
	};
}

describe('calculateLeaseMetrics — guards & null paths', () => {
	test('non-lease financing returns null', () => {
		expect(calculateLeaseMetrics(makeLease({ financingType: 'loan' }), 10000, 0)).toBeNull();
	});

	test('missing startDate returns null (no throw)', () => {
		expect(
			calculateLeaseMetrics(makeLease({ startDate: undefined as unknown as string }), 10000, 0)
		).toBeNull();
	});

	test('invalid startDate returns null (no throw / no NaN leak)', () => {
		expect(calculateLeaseMetrics(makeLease({ startDate: 'not-a-date' }), 10000, 0)).toBeNull();
	});

	test('null currentMileage still returns metrics with zero usage (no divide/NaN)', () => {
		const m = calculateLeaseMetrics(makeLease(), null, 0);
		expect(m).not.toBeNull();
		expect(m?.mileageUsed).toBe(0);
		// remaining defaults to the full limit when usage is unknown
		expect(m?.mileageRemaining).toBe(36000);
		expect(Number.isFinite(m?.projectedExcessFee ?? NaN)).toBe(true);
		expect(m?.isOverMileage).toBe(false);
	});

	// #148 FIX (C149, Angelo-decided 2026-06-23: null/zero initial → treat as 0). The mileage gate used to
	// require `initialMileage !== null`, so a lease with NO recorded starting odometer (the common case) left
	// mileageUsed=0 / mileageRemaining=full while the SIBLING PaymentMetricsGrid Overage card coalesced
	// `initialMileage ?? 0` (FinanceTab.svelte) and showed the true driven miles — the SAME vehicle contradicted
	// itself on one screen (the #140 class on the null-initialMileage axis). The fix coalesces `initialMileage ??
	// 0` inside calculateLeaseMetrics so the burn bar matches the Overage card. This test was the C102 red→green
	// anchor; it now asserts the FIXED semantics (null-initial drives used from 0, identical to initial=0).
	test('#148 FIX: null initialMileage is treated as 0 → mileageUsed = currentMileage (matches the Overage card)', () => {
		// currentMileage 30,000, NO initial recorded → coalesced to 0 → used = 30,000, remaining = total − used.
		const m = calculateLeaseMetrics(makeLease({ mileageLimit: 12000 }), 30000, null);
		expect(m).not.toBeNull();
		expect(m?.mileageUsed).toBe(30000); // FIXED: null initial treated as 0 (the burn bar now reads driven miles)
		expect(m?.mileageRemaining).toBe(6000); // 36000 term-scaled total − 30000 used
		// null-initial and initial=0 must now agree (the contradiction with the Overage card is resolved).
		const withZeroInitial = calculateLeaseMetrics(makeLease({ mileageLimit: 12000 }), 30000, 0);
		expect(withZeroInitial?.mileageUsed).toBe(30000);
		expect(m?.mileageUsed).toBe(withZeroInitial?.mileageUsed);
		expect(m?.mileageRemaining).toBe(withZeroInitial?.mileageRemaining);
	});

	// #110 (C374): endDate is nullable; when absent, calculateLeaseMetrics derives the lease end from
	// the term. The old fallback used termMonths × 30 DAYS — ~0.4 days short per month — so a 36-mo
	// lease ended ~16 days early, understating daysRemaining and inflating the excess-fee projection.
	// The fix uses addMonthsClamped (real CALENDAR months). This pins that a no-endDate lease's
	// daysRemaining matches the calendar-month end, and is STRICTLY MORE than the old ×30 fallback.
	test('a lease with NO endDate derives the end from CALENDAR months, not termMonths×30 (#110)', () => {
		// Start exactly today so daysElapsed ≈ 0 and daysRemaining ≈ the full lease span.
		const start = new Date();
		const startIso = start.toISOString().slice(0, 10);
		const m = calculateLeaseMetrics(
			makeLease({ startDate: startIso, endDate: undefined, termMonths: 36 }),
			null,
			0
		);
		expect(m).not.toBeNull();

		// Expected end via real calendar-month addition (clamped), the same helper the fix uses.
		const expectedEnd = new Date(start.getFullYear(), start.getMonth() + 36, start.getDate());
		const MS_DAY = 1000 * 60 * 60 * 24;
		const expectedTotalDays = Math.floor((expectedEnd.getTime() - start.getTime()) / MS_DAY);
		// daysRemaining ≈ expectedTotalDays (allow ±1 for the floor + same-day elapsed boundary).
		expect(Math.abs((m?.daysRemaining ?? 0) - expectedTotalDays)).toBeLessThanOrEqual(1);

		// The OLD ×30 fallback would give 36×30 = 1080 days; a real 36 calendar months is ~1096 →
		// strictly MORE. This is the load-bearing assertion: the fix can't silently revert to ×30.
		expect(m?.daysRemaining ?? 0).toBeGreaterThan(36 * 30);
	});
});

describe('calculateLeaseMetrics — mileage usage & remaining', () => {
	test('normal mid-lease usage: used = current − initial, remaining clamps to TERM-SCALED total', () => {
		// 12000/yr × 36mo = 36000 total allowance; used 12000 → 24000 remaining.
		const m = calculateLeaseMetrics(makeLease({ mileageLimit: 12000 }), 22000, 10000);
		expect(m?.mileageUsed).toBe(12000); // 22000 − 10000
		expect(m?.mileageRemaining).toBe(24000); // 36000 total − 12000
	});

	test('OVER the limit: remaining clamps to 0 (never negative)', () => {
		const m = calculateLeaseMetrics(makeLease({ mileageLimit: 12000 }), 60000, 10000);
		expect(m?.mileageUsed).toBe(50000); // 60000 − 10000
		expect(m?.mileageRemaining).toBe(0); // Math.max(0, 36000 total − 50000)
	});

	test('current below initial (odometer rollback / bad data): used clamps to 0', () => {
		const m = calculateLeaseMetrics(makeLease(), 5000, 10000);
		expect(m?.mileageUsed).toBe(0); // Math.max(0, 5000 − 10000)
		expect(m?.mileageRemaining).toBe(36000); // full term-scaled total (12000/yr × 3yr)
	});
});

describe('calculateLeaseMetrics — excess-mileage projection (the dollar figure)', () => {
	test('a fast burn rate projects an excess fee = excessMiles × per-mile fee', () => {
		// 30k used one year into a 12000/yr × 3yr = 36000-total lease, two years left → projects ~90k, well over.
		const m = calculateLeaseMetrics(
			makeLease({ mileageLimit: 12000, excessMileageFee: 0.25 }),
			40000,
			10000
		);
		expect(m).not.toBeNull();
		expect(m?.isOverMileage).toBe(true);
		expect(m?.projectedExcessMiles).toBeGreaterThan(0);
		// fee is exactly miles × per-mile rate
		expect(m?.projectedExcessFee).toBeCloseTo((m?.projectedExcessMiles ?? 0) * 0.25, 6);
	});

	test('on track (slow burn) projects NO excess against the term-scaled total: fee 0, not over', () => {
		// 3k used one year in on a 12000/yr × 3yr = 36000-total lease → on pace for ~9k, well under.
		const m = calculateLeaseMetrics(makeLease({ mileageLimit: 12000 }), 13000, 10000);
		expect(m?.projectedExcessMiles).toBe(0);
		expect(m?.projectedExcessFee).toBe(0);
		expect(m?.isOverMileage).toBe(false);
	});

	test('high INITIAL mileage (used-car lease) driven on-pace projects NO excess (driven-miles, not absolute odometer)', () => {
		// THE BUG: projectedFinalMileage is an ABSOLUTE odometer reading, but totalMileageAllowance +
		// mileageUsed are DRIVEN miles (current − initial). Comparing the absolute reading against the
		// driven budget over-reported excess by exactly `initialMileage`. Here: a car with 40,000 mi at
		// signing, one year into a 12000/yr × 3yr = 36000-total lease, driven 12,000 (exactly on pace) →
		// current 52,000, projects 76,000 absolute = 36,000 DRIVEN → exactly at the allowance, $0 excess.
		// Pre-fix: 76,000 − 36,000 = 40,000 phantom excess miles → a $10,000 phantom fee at $0.25/mi.
		const m = calculateLeaseMetrics(
			makeLease({ mileageLimit: 12000, excessMileageFee: 0.25 }),
			52000, // current odometer
			40000 // initial odometer at signing → driven 12000 one year in (on pace)
		);
		expect(m?.mileageUsed).toBe(12000); // 52000 − 40000
		expect(m?.projectedExcessMiles).toBe(0); // projects 36000 DRIVEN = the allowance, not 76000 absolute
		expect(m?.projectedExcessFee).toBe(0);
		expect(m?.isOverMileage).toBe(false);
	});

	test('missing excessMileageFee → excess miles can be >0 but fee is 0 (no NaN)', () => {
		const m = calculateLeaseMetrics(
			makeLease({ mileageLimit: 12000, excessMileageFee: undefined as unknown as number }),
			40000,
			10000
		);
		expect(m?.projectedExcessFee).toBe(0);
		expect(Number.isFinite(m?.projectedExcessFee ?? NaN)).toBe(true);
	});
});

describe('calculateLeaseMetrics — #64: the limit is ANNUAL, scaled by term', () => {
	// THE BUG (C198): mileageLimit is per-YEAR (the form labels it "Annual Mileage Limit"), but the math
	// compared the lifetime mileageUsed/projectedFinalMileage against the bare annual number, over-reporting
	// excess ~Nx on an N-year lease. The allowance must be annual × (termMonths / 12).
	test('a 3-year lease driven under its TRUE total allowance shows NO excess (was a phantom ~Nx fee pre-fix)', () => {
		// 12000/yr × 36mo = 36000 total. ~18 months in, driven 9000 (a 6000/yr pace) → projects ~18000
		// final, comfortably UNDER 36000. Pre-fix this compared the used/projection against the bare 12000
		// annual number → a large phantom excess + fee. With the term-scaled total it's correctly $0 excess.
		const m = calculateLeaseMetrics(
			makeLease({
				mileageLimit: 12000,
				termMonths: 36,
				startDate: isoDaysFromNow(-548), // ~18 months in
				endDate: isoDaysFromNow(548) // ~18 months left
			}),
			19000, // current
			10000 // initial → used 9000
		);
		expect(m).not.toBeNull();
		expect(m?.isOverMileage).toBe(false);
		expect(m?.projectedExcessMiles).toBe(0);
		expect(m?.projectedExcessFee).toBe(0);
	});

	test('mileageRemaining reflects the term-scaled total, not the bare annual limit', () => {
		// 15000/yr × 24mo = 30000 total; used 10000 → 20000 remaining (NOT 15000 − 10000 = 5000, the bug).
		const m = calculateLeaseMetrics(
			makeLease({ mileageLimit: 15000, termMonths: 24, endDate: isoDaysFromNow(365) }),
			20000,
			10000
		);
		expect(m?.mileageRemaining).toBe(20000); // 30000 total − 10000 used
	});

	test('a longer term grants proportionally more allowance (annual × years)', () => {
		// Same 12000/yr annual, but a 48-mo term → 48000 total; used 12000 leaves 36000.
		const m = calculateLeaseMetrics(
			makeLease({ mileageLimit: 12000, termMonths: 48, endDate: isoDaysFromNow(365 * 3) }),
			22000,
			10000
		);
		expect(m?.mileageRemaining).toBe(36000); // 12000 × 4yr − 12000 used
	});
});

describe('calculateLeaseMetrics — brand-new lease (divide-by-zero edge)', () => {
	test('lease starting TODAY (daysElapsed 0) does not divide by zero', () => {
		const m = calculateLeaseMetrics(
			makeLease({ startDate: isoDaysFromNow(0), endDate: isoDaysFromNow(365 * 3) }),
			10000,
			10000
		);
		expect(m).not.toBeNull();
		// used 0 so far; projection must stay finite (milesPerDay guarded on daysElapsed>0)
		expect(m?.mileageUsed).toBe(0);
		expect(Number.isFinite(m?.projectedFinalMileage ?? NaN)).toBe(true);
		expect(Number.isFinite(m?.projectedExcessFee ?? NaN)).toBe(true);
		expect(m?.daysRemaining).toBeGreaterThanOrEqual(0);
		expect(m?.monthsRemaining).toBeGreaterThanOrEqual(0);
	});
});

describe('calculateLeaseMetrics — property: every numeric output finite & non-negative', () => {
	test('200 random valid leases never produce NaN/Infinity/negative metrics', () => {
		fc.assert(
			fc.property(
				fc.integer({ min: 0, max: 200000 }), // initialMileage
				fc.integer({ min: 0, max: 200000 }), // delta to currentMileage
				fc.integer({ min: 1, max: 100000 }), // mileageLimit (>0)
				fc.integer({ min: -700, max: 700 }), // start offset days (past or future)
				fc.integer({ min: 12, max: 60 }), // termMonths
				fc.float({ min: 0, max: 2, noNaN: true }), // excessMileageFee
				(initial, delta, limit, startOffset, termMonths, fee) => {
					const m = calculateLeaseMetrics(
						makeLease({
							mileageLimit: limit,
							excessMileageFee: fee,
							termMonths,
							startDate: isoDaysFromNow(startOffset),
							endDate: isoDaysFromNow(startOffset + termMonths * 30)
						}),
						initial + delta,
						initial
					);
					if (m === null) return; // null is an acceptable guarded outcome
					for (const v of [
						m.mileageUsed,
						m.mileageRemaining,
						m.projectedFinalMileage,
						m.projectedExcessMiles,
						m.projectedExcessFee,
						m.daysRemaining,
						m.monthsRemaining
					]) {
						expect(Number.isFinite(v)).toBe(true);
						expect(v).toBeGreaterThanOrEqual(0);
					}
				}
			),
			{ numRuns: 200 }
		);
	});

	// THE #91 GUARD (C296): the merge-surviving property for the coordinate-space bug class. Lease overage
	// is about miles DRIVEN, not the absolute odometer — so adding the SAME constant to both initialMileage
	// and currentMileage shifts only the odometer baseline (the car was simply leased with more miles on it),
	// NOT how far it's driven or projected to drive. Every DRIVEN-miles output must be invariant under that
	// shift; only projectedFinalMileage (an absolute reading) moves by the constant. The #91 bug compared the
	// absolute projectedFinalMileage against the driven-miles budget, so a baseline shift leaked straight into
	// projectedExcessMiles/Fee — this property would have caught it where the finiteness property above could
	// not (the over-reported fee was still finite & non-negative). A single example pins one point; this pins
	// the whole class so the absolute-vs-driven mix can't silently return.
	test('#91: driven-miles outputs are INVARIANT under an equal shift of initial+current (only the absolute odometer moves)', () => {
		fc.assert(
			fc.property(
				fc.integer({ min: 0, max: 100000 }), // base initialMileage
				fc.integer({ min: 0, max: 100000 }), // delta driven (current − initial)
				fc.integer({ min: 1, max: 150000 }), // baseline shift (extra miles already on the car at signing)
				fc.integer({ min: 1, max: 100000 }), // mileageLimit (>0)
				fc.integer({ min: -700, max: 700 }), // start offset days
				fc.integer({ min: 12, max: 60 }), // termMonths
				fc.float({ min: 0, max: 2, noNaN: true }), // excessMileageFee
				(initial, driven, shift, limit, startOffset, termMonths, fee) => {
					const lease = makeLease({
						mileageLimit: limit,
						excessMileageFee: fee,
						termMonths,
						startDate: isoDaysFromNow(startOffset),
						endDate: isoDaysFromNow(startOffset + termMonths * 30)
					});
					const base = calculateLeaseMetrics(lease, initial + driven, initial);
					const shifted = calculateLeaseMetrics(lease, initial + driven + shift, initial + shift);
					if (base === null || shifted === null) return; // both guard identically (same dates)

					// Driven-miles space: identical regardless of the odometer baseline.
					expect(shifted.mileageUsed).toBeCloseTo(base.mileageUsed, 6);
					expect(shifted.mileageRemaining).toBeCloseTo(base.mileageRemaining, 6);
					expect(shifted.projectedExcessMiles).toBeCloseTo(base.projectedExcessMiles, 6);
					expect(shifted.projectedExcessFee).toBeCloseTo(base.projectedExcessFee, 6);
					expect(shifted.isOverMileage).toBe(base.isOverMileage);
					// Absolute-odometer space: this one DOES move by exactly the shift.
					expect(shifted.projectedFinalMileage).toBeCloseTo(base.projectedFinalMileage + shift, 6);
				}
			),
			{ numRuns: 200 }
		);
	});
});

// ---------------------------------------------------------------------------
// resolveCurrentOdometer (C157, bug lease/loan — Angelo-approved C151): lease overage + loan miles-used
// must derive from the ALL-TIME, all-sources `currentOdometer`, NOT the period-scoped + fuel-only
// `currentMileage` (which shrinks under a 7d/30d stats window and ignores manual odometer entries). This
// pins the selection contract both FinanceTab call sites share so a refactor can't silently re-introduce
// the period-scoped value as the primary input.
// ---------------------------------------------------------------------------
describe('resolveCurrentOdometer — prefers all-time currentOdometer over period-scoped currentMileage', () => {
	test('currentOdometer wins when present, even if currentMileage is lower (the period-scoped bug case)', () => {
		// The whole point: a 7d window made currentMileage drop to 12,100 while the true odometer is 48,000.
		expect(resolveCurrentOdometer(48_000, 12_100, 10_000)).toBe(48_000);
	});

	test('falls back to currentMileage when currentOdometer is null/undefined', () => {
		expect(resolveCurrentOdometer(null, 30_000, 10_000)).toBe(30_000);
		expect(resolveCurrentOdometer(undefined, 30_000, 10_000)).toBe(30_000);
	});

	test('falls back to initialMileage when both odometer readings are absent', () => {
		expect(resolveCurrentOdometer(null, null, 10_000)).toBe(10_000);
		expect(resolveCurrentOdometer(undefined, undefined, 10_000)).toBe(10_000);
	});

	test('returns null when nothing is available', () => {
		expect(resolveCurrentOdometer(null, null, null)).toBeNull();
		expect(resolveCurrentOdometer(undefined, undefined, undefined)).toBeNull();
	});

	test('a zero currentOdometer is honored (??, not ||) — 0 is a real reading, not "missing"', () => {
		// `0 ?? x` returns 0; a `0 || x` bug would wrongly skip to currentMileage.
		expect(resolveCurrentOdometer(0, 12_100, 10_000)).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// calculateLeaseOverage (C398, the #64/#110 annual-vs-total class on the PaymentMetricsGrid "Mileage
// Overage" card): the card compared the LIFETIME driven `mileageUsed` against the bare ANNUAL
// `financing.mileageLimit`, while the sibling LeaseMetricsCard correctly scales by the term — so the
// two cards on the SAME Finance-tab screen contradicted, and this one over-reported the overage + $ fee
// ~Nx on an N-year lease (a 36k-total lease driven 30k showed "18,000 over" + a phantom fee instead of
// 0). The fix routes both through leaseTotalMileageAllowance (annual × termMonths/12). These pin the
// term-scaling so the bare-annual compare can't silently return; reverting the helper → RED here.
// ---------------------------------------------------------------------------
describe('leaseTotalMileageAllowance — annual limit scaled by term', () => {
	test('12000/yr on a 36-mo lease = 36000 total (not the bare 12000)', () => {
		expect(leaseTotalMileageAllowance(makeLease({ mileageLimit: 12000, termMonths: 36 }))).toBe(36000);
	});

	test('15000/yr on a 24-mo lease = 30000 total', () => {
		expect(leaseTotalMileageAllowance(makeLease({ mileageLimit: 15000, termMonths: 24 }))).toBe(30000);
	});

	test('a 0 termMonths falls back to the annual limit (term≈12mo), never 0/NaN', () => {
		expect(leaseTotalMileageAllowance(makeLease({ mileageLimit: 12000, termMonths: 0 }))).toBe(12000);
	});

	test('no mileageLimit → 0 allowance (no NaN)', () => {
		expect(
			leaseTotalMileageAllowance(makeLease({ mileageLimit: undefined as unknown as number }))
		).toBe(0);
	});
});

describe('calculateLeaseOverage — current overage vs the TERM-SCALED total (#64/#110)', () => {
	test('driven UNDER the term-scaled total shows NO overage (the bug showed a phantom ~Nx fee)', () => {
		// THE BUG: 30000 driven on a 12000/yr × 36mo = 36000-total lease is UNDER the allowance → $0.
		// Pre-fix compared 30000 against the bare 12000 annual → 18000 phantom excess + a $4500 fee.
		const { excessMiles, overageCost } = calculateLeaseOverage(
			makeLease({ mileageLimit: 12000, termMonths: 36, excessMileageFee: 0.25 }),
			30000
		);
		expect(excessMiles).toBe(0);
		expect(overageCost).toBe(0);
	});

	test('genuinely over the term-scaled total bills the excess × per-mile fee', () => {
		// 40000 driven on a 36000-total lease → 4000 over × $0.25 = $1000.
		const { excessMiles, overageCost } = calculateLeaseOverage(
			makeLease({ mileageLimit: 12000, termMonths: 36, excessMileageFee: 0.25 }),
			40000
		);
		expect(excessMiles).toBe(4000);
		expect(overageCost).toBeCloseTo(1000, 6);
	});

	test('a longer term grants proportionally more allowance before any overage', () => {
		// Same 12000/yr, but a 48-mo term → 48000 total; 40000 driven is comfortably under → $0.
		const { excessMiles, overageCost } = calculateLeaseOverage(
			makeLease({ mileageLimit: 12000, termMonths: 48, excessMileageFee: 0.25 }),
			40000
		);
		expect(excessMiles).toBe(0);
		expect(overageCost).toBe(0);
	});

	test('agrees with calculateLeaseMetrics on the allowance (both route through leaseTotalMileageAllowance)', () => {
		// The two Finance-tab cards must use the SAME total allowance. mileageRemaining = total − used.
		const lease = makeLease({ mileageLimit: 12000, termMonths: 36 });
		const used = 24000;
		const metrics = calculateLeaseMetrics(lease, 34000, 10000); // used = 34000 − 10000 = 24000
		expect(metrics?.mileageRemaining).toBe(leaseTotalMileageAllowance(lease) - used); // 36000 − 24000 = 12000
		// And the overage card is consistent: 24000 driven < 36000 total → no current overage.
		expect(calculateLeaseOverage(lease, used).excessMiles).toBe(0);
	});

	test('missing excessMileageFee → excess miles can be >0 but cost is 0 (no NaN)', () => {
		const { excessMiles, overageCost } = calculateLeaseOverage(
			makeLease({ mileageLimit: 12000, termMonths: 36, excessMileageFee: undefined as unknown as number }),
			50000
		);
		expect(excessMiles).toBe(14000); // 50000 − 36000
		expect(overageCost).toBe(0);
		expect(Number.isFinite(overageCost)).toBe(true);
	});

	test('a non-lease (loan) returns zero overage', () => {
		expect(calculateLeaseOverage(makeLease({ financingType: 'loan' }), 99999)).toEqual({
			excessMiles: 0,
			overageCost: 0
		});
	});

	test('a lease with no mileageLimit returns zero overage (the card is hidden anyway)', () => {
		expect(
			calculateLeaseOverage(makeLease({ mileageLimit: undefined as unknown as number }), 99999)
		).toEqual({ excessMiles: 0, overageCost: 0 });
	});
});
