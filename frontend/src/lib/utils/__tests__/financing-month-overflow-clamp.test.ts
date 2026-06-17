/**
 * C330 — month-overflow CLAMP across the financing date projections (sibling of #90/#91/#92).
 *
 * JS `Date.setMonth(getMonth() + n)` rolls a day-of-month overflow into the FOLLOWING month
 * (Aug 31 + 1mo → Oct 1, since Sept has no 31st; May 31 + term → the month after the intended
 * end). Three financing-calculations.ts sites advanced months that way and silently shifted a
 * payment/payoff/lease-end date into the WRONG month for any contract dated on the 29th–31st:
 *   1. calculatePaymentDate (amortization-schedule + extra-payment-impact payoff dates)  [internal]
 *   2. calculateNextPaymentDate (the NextPaymentCard "due" date)  [pinned in next-payment-date.test.ts]
 *   3. calculatePayoffDate, lease path (start + termMonths)  [pinned here]
 * C330 routes all three through the shared `addMonthsClamped`, which detects the rolled day and
 * `setDate(0)`s back to the target month's last day — the same clamp `calculatePayoffDateFromStart`
 * already used inline. These pin the lease-end clamp (the C330 site with zero prior coverage); the
 * monthly next-payment clamp is pinned in next-payment-date.test.ts, and the amortization-preview
 * clamp in payoff-date-from-start.test.ts. NON-VACUOUS: reverting any site to bare setMonth lands the
 * 31st-start dates a month late (RED).
 *
 * Date OBJECTS (not 'YYYY-MM-DD' strings) so getFullYear/getMonth/getDate read in the same frame the
 * fn constructs (the C103/C77 UTC-parse trap).
 */

import { describe, expect, test } from 'vitest';
import type { VehicleFinancing } from '$lib/types';
import { calculatePayoffDate } from '$lib/utils/financing-calculations';

function makeLease(overrides: Partial<VehicleFinancing> = {}): VehicleFinancing {
	return {
		id: 'fin-lease',
		vehicleId: 'vehicle-1',
		financingType: 'lease',
		provider: 'Test Leasing',
		originalAmount: 30000,
		computedBalance: 30000,
		apr: 4.0,
		termMonths: 36,
		startDate: new Date(2024, 4, 31) as unknown as string, // May 31, 2024 (local frame)
		paymentAmount: 500,
		paymentFrequency: 'monthly',
		isActive: true,
		createdAt: '2024-05-31T00:00:00.000Z',
		updatedAt: '2024-05-31T00:00:00.000Z',
		...overrides
	};
}

describe('calculatePayoffDate — lease end-date month-overflow clamp (C330)', () => {
	test('May 31 + 36 months clamps to May 31, 2027 (no overflow needed — May has 31 days)', () => {
		const end = calculatePayoffDate(makeLease({ termMonths: 36 }));
		expect(end.getFullYear()).toBe(2027);
		expect(end.getMonth()).toBe(4); // May
		expect(end.getDate()).toBe(31);
	});

	test('May 31 + 1 month clamps to Jun 30 — NOT rolled forward to Jul 1', () => {
		const end = calculatePayoffDate(makeLease({ termMonths: 1 }));
		expect(end.getMonth()).toBe(5); // June (the intended month), not July
		expect(end.getDate()).toBe(30); // clamped to June's last day
	});

	test('Jan 31 + 1 month clamps to Feb 29 in a leap year — NOT Mar 2', () => {
		const end = calculatePayoffDate(
			makeLease({ startDate: new Date(2024, 0, 31) as unknown as string, termMonths: 1 })
		);
		expect(end.getMonth()).toBe(1); // February
		expect(end.getDate()).toBe(29); // 2024 is a leap year
	});

	test('Aug 31 + 13 months clamps to Sep 30, 2025 — a short target month after a year rollover', () => {
		const end = calculatePayoffDate(
			makeLease({ startDate: new Date(2024, 7, 31) as unknown as string, termMonths: 13 })
		);
		expect(end.getFullYear()).toBe(2025);
		expect(end.getMonth()).toBe(8); // September (Aug + 13 = next Sept), clamped from the 31st
		expect(end.getDate()).toBe(30);
	});

	test('a mid-month lease (15th) is unaffected — lands on the same day-of-month', () => {
		const end = calculatePayoffDate(
			makeLease({ startDate: new Date(2024, 2, 15) as unknown as string, termMonths: 24 })
		);
		expect(end.getFullYear()).toBe(2026);
		expect(end.getMonth()).toBe(2); // March
		expect(end.getDate()).toBe(15);
	});
});
