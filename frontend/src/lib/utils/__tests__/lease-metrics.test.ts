import { describe, expect, test } from 'vitest';
import fc from 'fast-check';
import type { VehicleFinancing } from '$lib/types';
import {
	calculateLeaseMetrics,
	calculateLeaseOverage,
	leaseTotalMileageAllowance,
	resolveCurrentOdometer
} from '$lib/utils/financing-calculations';

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
		startDate: isoDaysFromNow(-365),
		endDate: isoDaysFromNow(365 * 2),
		paymentAmount: 400,
		paymentFrequency: 'monthly',
		isActive: true,
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
		expect(m?.mileageRemaining).toBe(36000);
		expect(Number.isFinite(m?.projectedExcessFee ?? NaN)).toBe(true);
		expect(m?.isOverMileage).toBe(false);
	});

	test('null initialMileage is treated as 0, matching the overage card', () => {
		const m = calculateLeaseMetrics(makeLease({ mileageLimit: 12000 }), 30000, null);
		expect(m).not.toBeNull();
		expect(m?.mileageUsed).toBe(30000);
		expect(m?.mileageRemaining).toBe(6000);
		const withZeroInitial = calculateLeaseMetrics(makeLease({ mileageLimit: 12000 }), 30000, 0);
		expect(withZeroInitial?.mileageUsed).toBe(30000);
		expect(m?.mileageUsed).toBe(withZeroInitial?.mileageUsed);
		expect(m?.mileageRemaining).toBe(withZeroInitial?.mileageRemaining);
	});

	test('a lease with NO endDate derives the end from CALENDAR months, not termMonths×30', () => {
		const start = new Date();
		const startIso = start.toISOString().slice(0, 10);
		const m = calculateLeaseMetrics(
			makeLease({ startDate: startIso, endDate: undefined, termMonths: 36 }),
			null,
			0
		);
		expect(m).not.toBeNull();

		const expectedEnd = new Date(start.getFullYear(), start.getMonth() + 36, start.getDate());
		const MS_DAY = 1000 * 60 * 60 * 24;
		const expectedTotalDays = Math.floor((expectedEnd.getTime() - start.getTime()) / MS_DAY);
		expect(Math.abs((m?.daysRemaining ?? 0) - expectedTotalDays)).toBeLessThanOrEqual(1);

		expect(m?.daysRemaining ?? 0).toBeGreaterThan(36 * 30);
	});
});

describe('calculateLeaseMetrics — mileage usage & remaining', () => {
	test('normal mid-lease usage: used = current − initial, remaining clamps to TERM-SCALED total', () => {
		const m = calculateLeaseMetrics(makeLease({ mileageLimit: 12000 }), 22000, 10000);
		expect(m?.mileageUsed).toBe(12000);
		expect(m?.mileageRemaining).toBe(24000);
	});

	test('OVER the limit: remaining clamps to 0 (never negative)', () => {
		const m = calculateLeaseMetrics(makeLease({ mileageLimit: 12000 }), 60000, 10000);
		expect(m?.mileageUsed).toBe(50000);
		expect(m?.mileageRemaining).toBe(0);
	});

	test('current below initial (odometer rollback / bad data): used clamps to 0', () => {
		const m = calculateLeaseMetrics(makeLease(), 5000, 10000);
		expect(m?.mileageUsed).toBe(0);
		expect(m?.mileageRemaining).toBe(36000);
	});
});

describe('calculateLeaseMetrics — excess-mileage projection (the dollar figure)', () => {
	test('a fast burn rate projects an excess fee = excessMiles × per-mile fee', () => {
		const m = calculateLeaseMetrics(
			makeLease({ mileageLimit: 12000, excessMileageFee: 0.25 }),
			40000,
			10000
		);
		expect(m).not.toBeNull();
		expect(m?.isOverMileage).toBe(true);
		expect(m?.projectedExcessMiles).toBeGreaterThan(0);
		expect(m?.projectedExcessFee).toBeCloseTo((m?.projectedExcessMiles ?? 0) * 0.25, 6);
	});

	test('on track (slow burn) projects NO excess against the term-scaled total: fee 0, not over', () => {
		const m = calculateLeaseMetrics(makeLease({ mileageLimit: 12000 }), 13000, 10000);
		expect(m?.projectedExcessMiles).toBe(0);
		expect(m?.projectedExcessFee).toBe(0);
		expect(m?.isOverMileage).toBe(false);
	});

	test('high INITIAL mileage (used-car lease) driven on-pace projects NO excess (driven-miles, not absolute odometer)', () => {
		const m = calculateLeaseMetrics(
			makeLease({ mileageLimit: 12000, excessMileageFee: 0.25 }),
			52000,
			40000
		);
		expect(m?.mileageUsed).toBe(12000);
		expect(m?.projectedExcessMiles).toBe(0);
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

describe('calculateLeaseMetrics — the limit is ANNUAL, scaled by term', () => {
	test('a 3-year lease driven under its total allowance shows no excess', () => {
		const m = calculateLeaseMetrics(
			makeLease({
				mileageLimit: 12000,
				termMonths: 36,
				startDate: isoDaysFromNow(-548),
				endDate: isoDaysFromNow(548)
			}),
			19000,
			10000
		);
		expect(m).not.toBeNull();
		expect(m?.isOverMileage).toBe(false);
		expect(m?.projectedExcessMiles).toBe(0);
		expect(m?.projectedExcessFee).toBe(0);
	});

	test('mileageRemaining reflects the term-scaled total, not the bare annual limit', () => {
		const m = calculateLeaseMetrics(
			makeLease({ mileageLimit: 15000, termMonths: 24, endDate: isoDaysFromNow(365) }),
			20000,
			10000
		);
		expect(m?.mileageRemaining).toBe(20000);
	});

	test('a longer term grants proportionally more allowance (annual × years)', () => {
		const m = calculateLeaseMetrics(
			makeLease({ mileageLimit: 12000, termMonths: 48, endDate: isoDaysFromNow(365 * 3) }),
			22000,
			10000
		);
		expect(m?.mileageRemaining).toBe(36000);
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
				fc.integer({ min: 0, max: 200000 }),
				fc.integer({ min: 0, max: 200000 }),
				fc.integer({ min: 1, max: 100000 }),
				fc.integer({ min: -700, max: 700 }),
				fc.integer({ min: 12, max: 60 }),
				fc.float({ min: 0, max: 2, noNaN: true }),
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
					if (m === null) return;
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

	test('driven-miles outputs are INVARIANT under an equal shift of initial+current (only the absolute odometer moves)', () => {
		fc.assert(
			fc.property(
				fc.integer({ min: 0, max: 100000 }),
				fc.integer({ min: 0, max: 100000 }),
				fc.integer({ min: 1, max: 150000 }),
				fc.integer({ min: 1, max: 100000 }),
				fc.integer({ min: -700, max: 700 }),
				fc.integer({ min: 12, max: 60 }),
				fc.float({ min: 0, max: 2, noNaN: true }),
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
					if (base === null || shifted === null) return;

					expect(shifted.mileageUsed).toBeCloseTo(base.mileageUsed, 6);
					expect(shifted.mileageRemaining).toBeCloseTo(base.mileageRemaining, 6);
					expect(shifted.projectedExcessMiles).toBeCloseTo(base.projectedExcessMiles, 6);
					expect(shifted.projectedExcessFee).toBeCloseTo(base.projectedExcessFee, 6);
					expect(shifted.isOverMileage).toBe(base.isOverMileage);
					expect(shifted.projectedFinalMileage).toBeCloseTo(base.projectedFinalMileage + shift, 6);
				}
			),
			{ numRuns: 200 }
		);
	});
});

describe('resolveCurrentOdometer — prefers all-time currentOdometer over period-scoped currentMileage', () => {
	test('currentOdometer wins over a lower period-scoped currentMileage', () => {
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
		expect(resolveCurrentOdometer(0, 12_100, 10_000)).toBe(0);
	});
});

describe('leaseTotalMileageAllowance — annual limit scaled by term', () => {
	test('12000/yr on a 36-mo lease = 36000 total (not the bare 12000)', () => {
		expect(leaseTotalMileageAllowance(makeLease({ mileageLimit: 12000, termMonths: 36 }))).toBe(
			36000
		);
	});

	test('15000/yr on a 24-mo lease = 30000 total', () => {
		expect(leaseTotalMileageAllowance(makeLease({ mileageLimit: 15000, termMonths: 24 }))).toBe(
			30000
		);
	});

	test('a 0 termMonths falls back to the annual limit (term≈12mo), never 0/NaN', () => {
		expect(leaseTotalMileageAllowance(makeLease({ mileageLimit: 12000, termMonths: 0 }))).toBe(
			12000
		);
	});

	test('no mileageLimit → 0 allowance (no NaN)', () => {
		expect(
			leaseTotalMileageAllowance(makeLease({ mileageLimit: undefined as unknown as number }))
		).toBe(0);
	});
});

describe('calculateLeaseOverage — current overage vs the TERM-SCALED total', () => {
	test('driven under the term-scaled total shows no overage', () => {
		const { excessMiles, overageCost } = calculateLeaseOverage(
			makeLease({ mileageLimit: 12000, termMonths: 36, excessMileageFee: 0.25 }),
			30000
		);
		expect(excessMiles).toBe(0);
		expect(overageCost).toBe(0);
	});

	test('genuinely over the term-scaled total bills the excess × per-mile fee', () => {
		const { excessMiles, overageCost } = calculateLeaseOverage(
			makeLease({ mileageLimit: 12000, termMonths: 36, excessMileageFee: 0.25 }),
			40000
		);
		expect(excessMiles).toBe(4000);
		expect(overageCost).toBeCloseTo(1000, 6);
	});

	test('a longer term grants proportionally more allowance before any overage', () => {
		const { excessMiles, overageCost } = calculateLeaseOverage(
			makeLease({ mileageLimit: 12000, termMonths: 48, excessMileageFee: 0.25 }),
			40000
		);
		expect(excessMiles).toBe(0);
		expect(overageCost).toBe(0);
	});

	test('agrees with calculateLeaseMetrics on the allowance (both route through leaseTotalMileageAllowance)', () => {
		const lease = makeLease({ mileageLimit: 12000, termMonths: 36 });
		const used = 24000;
		const metrics = calculateLeaseMetrics(lease, 34000, 10000);
		expect(metrics?.mileageRemaining).toBe(leaseTotalMileageAllowance(lease) - used);
		expect(calculateLeaseOverage(lease, used).excessMiles).toBe(0);
	});

	test('missing excessMileageFee → excess miles can be >0 but cost is 0 (no NaN)', () => {
		const { excessMiles, overageCost } = calculateLeaseOverage(
			makeLease({
				mileageLimit: 12000,
				termMonths: 36,
				excessMileageFee: undefined as unknown as number
			}),
			50000
		);
		expect(excessMiles).toBe(14000);
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
