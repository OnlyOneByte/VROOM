/**
 * Regression: calculateExtraPaymentImpact on a 0%-APR loan (#92, C297 bug cycle).
 *
 * The early guard was `financing.financingType !== 'loan' || !financing.apr || financing.apr <= 0`,
 * which lumped every interest-free loan (apr 0, or no APR entered) in with leases/own and returned a
 * FLAT { monthsSaved: 0, interestSaved: 0 }. But a 0%-APR loan is interest-free, NOT inert — extra
 * payments retire the principal faster and genuinely shorten the term. The PaymentPlannerDialog renders
 * `impact.monthsSaved` ("{n} mos"), so an interest-free loan wrongly showed "0 mos" for an extra payment
 * that obviously shortens the payoff. NORTH_STAR #2 (correct-for-everyone — a 0% dealer-financing loan is
 * common). The amortization loop already handles 0% correctly (rate 0 → full payment to principal), so the
 * fix only bails early for NON-loans and lets 0%-APR loans run the loop with rate 0. These lock that.
 */

import { describe, expect, test } from 'vitest';
import type { VehicleFinancing } from '$lib/types';
import { calculateExtraPaymentImpact } from '$lib/utils/financing-calculations';

function makeLoan(overrides: Partial<VehicleFinancing> = {}): VehicleFinancing {
	return {
		id: 'fin-1',
		vehicleId: 'vehicle-1',
		financingType: 'loan',
		provider: 'Test Bank',
		originalAmount: 12_000,
		computedBalance: 12_000,
		apr: 0,
		termMonths: 24,
		startDate: '2024-01-01',
		paymentAmount: 500,
		paymentFrequency: 'monthly',
		isActive: true,
		createdAt: '2024-01-01T00:00:00.000Z',
		updatedAt: '2024-01-01T00:00:00.000Z',
		...overrides
	};
}

describe('calculateExtraPaymentImpact — 0%-APR loan is interest-free but NOT inert (#92)', () => {
	test('a 0%-APR loan + extra payment shortens the term (monthsSaved > 0), interestSaved stays $0', () => {
		// $12,000 @ 0% / $500 a month = 24 months. Doubling the payment to $1,000 → 12 months → saves 12.
		const impact = calculateExtraPaymentImpact(makeLoan(), 500);
		expect(impact.monthsSaved).toBe(12); // 24 − 12
		expect(impact.interestSaved).toBe(0); // 0% → never any interest to save
		expect(impact.totalSavings).toBe(0);
	});

	test('a bigger extra payment on a 0%-APR loan saves at least as many months (monotonic)', () => {
		const small = calculateExtraPaymentImpact(makeLoan(), 100);
		const big = calculateExtraPaymentImpact(makeLoan(), 500);
		expect(big.monthsSaved).toBeGreaterThanOrEqual(small.monthsSaved);
		expect(small.monthsSaved).toBeGreaterThan(0); // even a modest extra payment shortens a 0% loan
	});

	test('a positive-APR loan is unaffected by the fix (monthsSaved > 0 AND interestSaved > 0)', () => {
		// The fix must not regress the interest-bearing path: here both savings are real.
		const impact = calculateExtraPaymentImpact(
			makeLoan({ apr: 6, originalAmount: 20_000, computedBalance: 20_000, termMonths: 60 }),
			200
		);
		expect(impact.monthsSaved).toBeGreaterThan(0);
		expect(impact.interestSaved).toBeGreaterThan(0);
	});

	test('a non-loan (lease) is still inert (monthsSaved 0) — the early bail still applies', () => {
		const impact = calculateExtraPaymentImpact(makeLoan({ financingType: 'lease' }), 500);
		expect(impact.monthsSaved).toBe(0);
		expect(impact.interestSaved).toBe(0);
	});
});
