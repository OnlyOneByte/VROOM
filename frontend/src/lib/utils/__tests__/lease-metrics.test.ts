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
import { calculateLeaseMetrics } from '$lib/utils/financing-calculations';

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
		mileageLimit: 36000,
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
});

describe('calculateLeaseMetrics — mileage usage & remaining', () => {
	test('normal mid-lease usage: used = current − initial, remaining clamps to limit', () => {
		const m = calculateLeaseMetrics(makeLease({ mileageLimit: 36000 }), 22000, 10000);
		expect(m?.mileageUsed).toBe(12000); // 22000 − 10000
		expect(m?.mileageRemaining).toBe(24000); // 36000 − 12000
	});

	test('OVER the limit: remaining clamps to 0 (never negative)', () => {
		const m = calculateLeaseMetrics(makeLease({ mileageLimit: 36000 }), 60000, 10000);
		expect(m?.mileageUsed).toBe(50000); // 60000 − 10000
		expect(m?.mileageRemaining).toBe(0); // Math.max(0, 36000 − 50000)
	});

	test('current below initial (odometer rollback / bad data): used clamps to 0', () => {
		const m = calculateLeaseMetrics(makeLease(), 5000, 10000);
		expect(m?.mileageUsed).toBe(0); // Math.max(0, 5000 − 10000)
		expect(m?.mileageRemaining).toBe(36000);
	});
});

describe('calculateLeaseMetrics — excess-mileage projection (the dollar figure)', () => {
	test('a fast burn rate projects an excess fee = excessMiles × per-mile fee', () => {
		// Used 30k of a 36k limit one year in, with two years left → projects well over.
		const m = calculateLeaseMetrics(
			makeLease({ mileageLimit: 36000, excessMileageFee: 0.25 }),
			40000,
			10000
		);
		expect(m).not.toBeNull();
		expect(m?.isOverMileage).toBe(true);
		expect(m?.projectedExcessMiles).toBeGreaterThan(0);
		// fee is exactly miles × per-mile rate
		expect(m?.projectedExcessFee).toBeCloseTo((m?.projectedExcessMiles ?? 0) * 0.25, 6);
	});

	test('on track (slow burn) projects NO excess: fee 0, not over', () => {
		// 3k used one year in on a 36k/3yr lease → on pace for ~9k, well under.
		const m = calculateLeaseMetrics(makeLease({ mileageLimit: 36000 }), 13000, 10000);
		expect(m?.projectedExcessMiles).toBe(0);
		expect(m?.projectedExcessFee).toBe(0);
		expect(m?.isOverMileage).toBe(false);
	});

	test('missing excessMileageFee → excess miles can be >0 but fee is 0 (no NaN)', () => {
		const m = calculateLeaseMetrics(
			makeLease({ mileageLimit: 36000, excessMileageFee: undefined as unknown as number }),
			40000,
			10000
		);
		expect(m?.projectedExcessFee).toBe(0);
		expect(Number.isFinite(m?.projectedExcessFee ?? NaN)).toBe(true);
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
});
