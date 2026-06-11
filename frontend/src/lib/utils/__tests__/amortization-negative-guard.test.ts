/**
 * Regression: calculateAmortizationSchedule negative-amortization guard (C161 deep-review).
 *
 * When paymentAmount < the period's interest, principalAmount = paymentAmount − interest goes NEGATIVE,
 * so `remainingBalance − principalAmount` GROWS the balance every period — the schedule emitted rows with
 * negative principal + a climbing balance into the displayed amortization table (and into
 * derivePaymentEntries' totalPrincipalPaid / totalInterestPaid via FinanceTab). Its sibling functions
 * (calculatePayoffDate:238, calculateExtraPaymentImpact:311) both bail on `principalAmount <= 0`;
 * calculateAmortizationSchedule was the one that omitted the guard. Property 10 in
 * financing-calculations.property.test.ts explicitly `return`s on the under-funded case, so this path was
 * genuinely unpinned. The fix adds the same guard (break) — these tests lock it.
 */

import { describe, expect, test } from 'vitest';
import type { VehicleFinancing } from '$lib/types';
import { calculateAmortizationSchedule } from '$lib/utils/financing-calculations';

function makeLoan(overrides: Partial<VehicleFinancing> = {}): VehicleFinancing {
	return {
		id: 'fin-1',
		vehicleId: 'vehicle-1',
		financingType: 'loan',
		provider: 'Test Bank',
		originalAmount: 20_000,
		computedBalance: 20_000,
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

describe('calculateAmortizationSchedule — negative-amortization guard (C161)', () => {
	test('under-funded loan (payment < monthly interest) → no negative principal, non-increasing balance', () => {
		// 100k @ 30% APR → monthly interest = 100000 * 0.30/12 = $2500; payment $50 ≪ that.
		// Pre-fix: 60 rows with negative principal (−2450, −2511, …) + a balance climbing past 100k.
		// Post-fix: the loop breaks on the first non-amortizing period → no such rows.
		const schedule = calculateAmortizationSchedule(
			makeLoan({ originalAmount: 100_000, apr: 30, termMonths: 60, paymentAmount: 50 }),
			0
		);
		let prevBalance = 100_000;
		for (const row of schedule) {
			expect(row.principalAmount).toBeGreaterThan(0); // never negative
			expect(row.remainingBalance).toBeLessThanOrEqual(prevBalance + 1e-6); // never grows
			prevBalance = row.remainingBalance;
		}
	});

	test('the guard does not over-fire: a healthy loan still amortizes fully to a zero balance', () => {
		const schedule = calculateAmortizationSchedule(
			makeLoan({ originalAmount: 20_000, apr: 5, termMonths: 60, paymentAmount: 400 }),
			0
		);
		expect(schedule.length).toBeGreaterThan(0);
		let prevBalance = 20_000;
		for (const row of schedule) {
			expect(row.principalAmount).toBeGreaterThan(0);
			expect(row.remainingBalance).toBeLessThanOrEqual(prevBalance + 1e-6);
			prevBalance = row.remainingBalance;
		}
		expect(schedule[schedule.length - 1]?.remainingBalance).toBe(0);
	});
});
