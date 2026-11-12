import { describe, expect, test } from 'vitest';
import type { VehicleFinancing } from '#lib/types/index.ts';
import { calculateExtraPaymentImpact } from '#lib/utils/financing-calculations.ts';

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

describe('calculateExtraPaymentImpact — 0%-APR loan is interest-free but NOT inert', () => {
	test('a 0%-APR loan + extra payment shortens the term (monthsSaved > 0), interestSaved stays $0', () => {
		const impact = calculateExtraPaymentImpact(makeLoan(), 500);
		expect(impact.monthsSaved).toBe(12);
		expect(impact.interestSaved).toBe(0);
		expect(impact.totalSavings).toBe(0);
	});

	test('a bigger extra payment on a 0%-APR loan saves at least as many months (monotonic)', () => {
		const small = calculateExtraPaymentImpact(makeLoan(), 100);
		const big = calculateExtraPaymentImpact(makeLoan(), 500);
		expect(big.monthsSaved).toBeGreaterThanOrEqual(small.monthsSaved);
		expect(small.monthsSaved).toBeGreaterThan(0);
	});

	test('a positive-APR loan still reports both months and interest saved', () => {
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
