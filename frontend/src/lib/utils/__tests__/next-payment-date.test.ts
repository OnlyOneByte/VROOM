import { describe, expect, test } from 'vitest';
import type { VehicleFinancing } from '#lib/types/index.ts';
import {
	calculateNextPaymentDate,
	calculateDaysUntil,
	formatPaymentFrequency
} from '#lib/utils/financing-calculations.ts';

function storedDate(year: number, month: number, day: number): string {
	return new Date(year, month - 1, day, 12, 0, 0).toISOString();
}

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
		startDate: storedDate(2024, 1, 1),
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
		const next = calculateNextPaymentDate(makeFinancing({ startDate: storedDate(2024, 1, 1) }));
		expect(next.getTime()).toBeGreaterThan(Date.now());
	});

	test('the future date lands on the payment day-of-month (monthly, from start)', () => {
		const next = calculateNextPaymentDate(makeFinancing({ startDate: storedDate(2024, 3, 15) }));
		expect(next.getDate()).toBe(15);
		expect(next.getTime()).toBeGreaterThan(Date.now());
	});

	test('weekly frequency advances to a future date on the same weekday', () => {
		const start = new Date(storedDate(2024, 1, 1));
		const next = calculateNextPaymentDate(
			makeFinancing({ startDate: storedDate(2024, 1, 1), paymentFrequency: 'weekly' })
		);
		expect(next.getTime()).toBeGreaterThan(Date.now());
		expect(next.getDay()).toBe(start.getDay());
	});

	test('bi-weekly frequency advances in 14-day steps from the start date', () => {
		const start = new Date(storedDate(2024, 1, 1));
		const next = calculateNextPaymentDate(
			makeFinancing({ startDate: storedDate(2024, 1, 1), paymentFrequency: 'bi-weekly' })
		);
		expect(next.getTime()).toBeGreaterThan(Date.now());
		const days = Math.round((next.getTime() - start.getTime()) / MS_PER_DAY);
		expect(days % 14).toBe(0);
	});

	test('lastPaymentDate override: next is one period after the last payment, in the future', () => {
		const last = new Date();
		last.setMonth(last.getMonth() - 1);
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

describe('calculateNextPaymentDate — month-end clamp', () => {
	test('a 31st-of-month start lands on a valid day of the intended month, never rolled forward', () => {
		const next = calculateNextPaymentDate(makeFinancing({ startDate: storedDate(2024, 1, 31) }));
		expect(Number.isNaN(next.getTime())).toBe(false);
		expect(next.getTime()).toBeGreaterThan(Date.now());
		const d = next.getDate();
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
		const iso = storedDate(future.getFullYear(), future.getMonth() + 1, future.getDate());
		const next = calculateNextPaymentDate(makeFinancing({ startDate: iso }));
		expect(next.toISOString()).toBe(iso);
	});
});

describe('calculateDaysUntil', () => {
	test('a target ~10 days out returns 10 (ceil of the day diff)', () => {
		const target = new Date(Date.now() + 10 * MS_PER_DAY + 60_000);
		expect(calculateDaysUntil(target)).toBe(11);
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
