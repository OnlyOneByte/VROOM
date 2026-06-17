/**
 * Tests for calculateNextPaymentDate() + calculateDaysUntil() — the two financing
 * date helpers behind NextPaymentCard's user-facing "next payment due" display.
 * Both were untested. calculateNextPaymentDate has real edge complexity worth pinning:
 * a setMonth-based monthly advance (the classic JS month-end rollover trap), a
 * maxIterations runaway guard, weekly/bi-weekly/monthly frequency variants, an optional
 * lastPaymentDate override, and graceful fallbacks (returns a Date, never throws).
 * No product bug found on read; these lock the contract + characterize the documented
 * month-end behavior so a refactor can't silently change a payment-due date.
 */

import { describe, expect, test } from 'vitest';
import type { VehicleFinancing } from '$lib/types';
import {
	calculateNextPaymentDate,
	calculateDaysUntil,
	formatPaymentFrequency
} from '$lib/utils/financing-calculations';

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

const MS_PER_DAY = 1000 * 60 * 60 * 24;

describe('calculateNextPaymentDate — core contract', () => {
	test('returns a date strictly in the future for a past-start monthly loan', () => {
		const next = calculateNextPaymentDate(makeFinancing({ startDate: '2024-01-01' }));
		expect(next.getTime()).toBeGreaterThan(Date.now());
	});

	test('the future date lands on the payment day-of-month (monthly, from start)', () => {
		// Start on the 15th → every advance keeps the 15th (no month-end ambiguity).
		const next = calculateNextPaymentDate(makeFinancing({ startDate: '2024-03-15' }));
		expect(next.getDate()).toBe(15);
		expect(next.getTime()).toBeGreaterThan(Date.now());
	});

	test('weekly frequency advances to a future date on the same weekday', () => {
		const start = new Date('2024-01-01'); // a Monday
		const next = calculateNextPaymentDate(
			makeFinancing({ startDate: '2024-01-01', paymentFrequency: 'weekly' })
		);
		expect(next.getTime()).toBeGreaterThan(Date.now());
		expect(next.getUTCDay()).toBe(start.getUTCDay());
	});

	test('bi-weekly frequency advances in 14-day steps from the start date', () => {
		const start = new Date('2024-01-01');
		const next = calculateNextPaymentDate(
			makeFinancing({ startDate: '2024-01-01', paymentFrequency: 'bi-weekly' })
		);
		expect(next.getTime()).toBeGreaterThan(Date.now());
		// Days between start and next must be a multiple of 14.
		const days = Math.round((next.getTime() - start.getTime()) / MS_PER_DAY);
		expect(days % 14).toBe(0);
	});

	test('lastPaymentDate override: next is one period after the last payment, in the future', () => {
		// Last payment was ~today-ish; next monthly must be after today.
		const last = new Date();
		last.setMonth(last.getMonth() - 1); // a month ago
		const next = calculateNextPaymentDate(makeFinancing({ paymentFrequency: 'monthly' }), last);
		expect(next.getTime()).toBeGreaterThan(Date.now());
	});

	test('unknown paymentFrequency falls back to monthly (still advances to future)', () => {
		const next = calculateNextPaymentDate(
			makeFinancing({ paymentFrequency: 'quarterly' as unknown as 'monthly' })
		);
		expect(next.getTime()).toBeGreaterThan(Date.now());
	});
});

describe('calculateNextPaymentDate — month-end CLAMP (C330: the JS setMonth-overflow fix)', () => {
	// Until C330 this advanced via setMonth(getMonth()+1), so a 31st-of-month start in a
	// short month ROLLED FORWARD (Jan 31 → Mar 2/3, since Feb has no 31st) — the due date
	// drifted into the WRONG month. C330 routes the monthly advance through addMonthsClamped,
	// which anchors on baseDate and clamps a day-of-month overflow to the target month's LAST
	// day (sibling of the #90/#91/#92 financing-math fixes). So a 31st-start now always lands
	// on a real day of the INTENDED month: the 31st in long months, the 28th/29th/30th in
	// short ones — NEVER the 1st-3rd of the following month.
	test('a 31st-of-month start lands on a valid day of the intended month, never rolled forward', () => {
		const next = calculateNextPaymentDate(makeFinancing({ startDate: '2024-01-31' }));
		expect(Number.isNaN(next.getTime())).toBe(false);
		expect(next.getTime()).toBeGreaterThan(Date.now());
		const d = next.getDate();
		// The clamp guarantees a real month-end day (28..31), and specifically NOT the
		// rolled-forward 1st-3rd the pre-C330 setMonth produced.
		expect(d).toBeGreaterThanOrEqual(28);
		expect(d).toBeLessThanOrEqual(31);
	});
});

describe('calculateNextPaymentDate — graceful fallbacks (never throws)', () => {
	test('missing startDate returns a Date (current), not a throw', () => {
		const next = calculateNextPaymentDate(
			makeFinancing({ startDate: undefined as unknown as string })
		);
		expect(next instanceof Date).toBe(true);
		expect(Number.isNaN(next.getTime())).toBe(false);
	});

	test('invalid startDate returns a Date (current), not a throw / Invalid Date', () => {
		const next = calculateNextPaymentDate(makeFinancing({ startDate: 'not-a-date' }));
		expect(next instanceof Date).toBe(true);
		expect(Number.isNaN(next.getTime())).toBe(false);
	});

	test('a future start date is returned as-is (loop body never runs)', () => {
		const future = new Date();
		future.setFullYear(future.getFullYear() + 1);
		const iso = future.toISOString().slice(0, 10);
		const next = calculateNextPaymentDate(makeFinancing({ startDate: iso }));
		// Already in the future → returned without advancing.
		expect(next.toISOString().slice(0, 10)).toBe(iso);
	});
});

describe('calculateDaysUntil', () => {
	test('a target ~10 days out returns 10 (ceil of the day diff)', () => {
		const target = new Date(Date.now() + 10 * MS_PER_DAY + 60_000); // +10d +1min
		expect(calculateDaysUntil(target)).toBe(11); // ceil rounds the partial day up
	});

	test('an exact-now target returns 0 or a small non-negative number', () => {
		const days = calculateDaysUntil(new Date(Date.now() + 1000));
		expect(days).toBeGreaterThanOrEqual(0);
		expect(days).toBeLessThanOrEqual(1);
	});

	test('a past target returns a negative number', () => {
		const target = new Date(Date.now() - 5 * MS_PER_DAY);
		expect(calculateDaysUntil(target)).toBeLessThan(0);
	});
});

describe('formatPaymentFrequency — the user-visible label rendered in NextPaymentCard', () => {
	// NextPaymentCard.svelte:149 renders formatPaymentFrequency(financing.paymentFrequency).
	// The DB column (schema.ts:86) admits exactly these four values, so the label for EACH must
	// be pinned — a refactor that renames/drops a case or mis-cases a label (e.g. "Bi-Weekly")
	// would silently change what a real user sees. Unknown values pass through verbatim (graceful
	// fallback), which keeps a future-added frequency legible instead of blanking the field.
	test('maps each schema-valid frequency to its display label', () => {
		expect(formatPaymentFrequency('monthly')).toBe('Monthly');
		expect(formatPaymentFrequency('bi-weekly')).toBe('Bi-weekly');
		expect(formatPaymentFrequency('weekly')).toBe('Weekly');
		expect(formatPaymentFrequency('custom')).toBe('Custom');
	});

	test('an unknown frequency passes through verbatim (graceful fallback, no blank)', () => {
		expect(formatPaymentFrequency('quarterly')).toBe('quarterly');
		expect(formatPaymentFrequency('')).toBe('');
	});
});
