import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
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

describe('calculateNextPaymentDate — due date and overdue', () => {
	beforeEach(() => {
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(new Date(2026, 5, 20, 9, 0, 0));
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	test('with no payment since the last due date, that due date is returned so the card can show overdue', () => {
		const next = calculateNextPaymentDate(makeFinancing({ startDate: storedDate(2024, 1, 15) }));
		expect(next).toEqual(new Date(storedDate(2026, 6, 15)));
		expect(calculateDaysUntil(next)).toBeLessThan(0);
	});

	test('a payment since the previous due date covers the last one; next is one period later', () => {
		const next = calculateNextPaymentDate(
			makeFinancing({ startDate: storedDate(2024, 1, 15) }),
			new Date(storedDate(2026, 6, 13))
		);
		expect(next).toEqual(new Date(storedDate(2026, 7, 15)));
	});

	test('a payment made on or before the previous due date leaves the last due date unpaid', () => {
		const next = calculateNextPaymentDate(
			makeFinancing({ startDate: storedDate(2024, 1, 15) }),
			new Date(storedDate(2026, 5, 15))
		);
		expect(next).toEqual(new Date(storedDate(2026, 6, 15)));
	});

	test('the due day follows paymentDayOfMonth, not the day the payment was made', () => {
		const next = calculateNextPaymentDate(
			makeFinancing({ startDate: storedDate(2024, 1, 3), paymentDayOfMonth: 10 }),
			new Date(storedDate(2026, 6, 18))
		);
		expect(next).toEqual(new Date(storedDate(2026, 7, 10)));
	});

	test('the first due date is one period after the start, on the payment day', () => {
		const next = calculateNextPaymentDate(
			makeFinancing({ startDate: storedDate(2026, 6, 18), paymentDayOfMonth: 5 })
		);
		expect(next).toEqual(new Date(storedDate(2026, 7, 5)));
	});

	test('a loan that started this month with no payments yet is not overdue', () => {
		const next = calculateNextPaymentDate(makeFinancing({ startDate: storedDate(2026, 6, 1) }));
		expect(next).toEqual(new Date(storedDate(2026, 7, 1)));
		expect(calculateDaysUntil(next)).toBe(11);
	});

	test('while payments are unknown the last due date is assumed paid, so nothing reads overdue', () => {
		const next = calculateNextPaymentDate(
			makeFinancing({ startDate: storedDate(2024, 1, 15) }),
			undefined,
			true
		);
		expect(next).toEqual(new Date(storedDate(2026, 7, 15)));
	});

	test('weekly frequency stays on the start weekday', () => {
		const start = new Date(storedDate(2026, 1, 5));
		const next = calculateNextPaymentDate(
			makeFinancing({ startDate: storedDate(2026, 1, 5), paymentFrequency: 'weekly' }),
			new Date(2026, 5, 19)
		);
		expect(next.getTime()).toBeGreaterThan(Date.now());
		expect(next.getDay()).toBe(start.getDay());
	});

	test('bi-weekly frequency advances in 14-day steps from the start date', () => {
		const start = new Date(storedDate(2026, 1, 5));
		const next = calculateNextPaymentDate(
			makeFinancing({ startDate: storedDate(2026, 1, 5), paymentFrequency: 'bi-weekly' }),
			new Date(2026, 5, 19)
		);
		const days = Math.round((next.getTime() - start.getTime()) / MS_PER_DAY);
		expect(days % 14).toBe(0);
		expect(next.getTime()).toBeGreaterThan(Date.now());
	});

	test('unknown paymentFrequency falls back to monthly', () => {
		const next = calculateNextPaymentDate(
			makeFinancing({
				startDate: storedDate(2024, 1, 15),
				paymentFrequency: 'quarterly' as unknown as 'monthly'
			}),
			new Date(storedDate(2026, 6, 15))
		);
		expect(next).toEqual(new Date(storedDate(2026, 7, 15)));
	});
});

describe('calculateNextPaymentDate — month-end clamp', () => {
	test('a 31st-of-month start lands on a valid day of the intended month, never rolled forward', () => {
		const next = calculateNextPaymentDate(makeFinancing({ startDate: storedDate(2024, 1, 31) }));
		expect(Number.isNaN(next.getTime())).toBe(false);
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

	test('a future start date gives a first due date one period after it', () => {
		const future = new Date();
		future.setFullYear(future.getFullYear() + 1);
		const start = storedDate(future.getFullYear(), future.getMonth() + 1, 10);
		const next = calculateNextPaymentDate(makeFinancing({ startDate: start }));
		expect(next).toEqual(new Date(storedDate(future.getFullYear(), future.getMonth() + 2, 10)));
	});
});

describe('calculateDaysUntil counts calendar days', () => {
	beforeEach(() => {
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(new Date(2026, 5, 20, 21, 0, 0));
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	test('a date 10 days ahead is 10 whatever the time of day', () => {
		expect(calculateDaysUntil(new Date(2026, 5, 30, 1, 0, 0))).toBe(10);
		expect(calculateDaysUntil(new Date(2026, 5, 30, 23, 0, 0))).toBe(10);
	});

	test('earlier today is 0, not negative', () => {
		expect(calculateDaysUntil(new Date(2026, 5, 20, 12, 0, 0))).toBe(0);
	});

	test('a noon due date five days ago is -5 in the evening too', () => {
		expect(calculateDaysUntil(new Date(2026, 5, 15, 12, 0, 0))).toBe(-5);
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
