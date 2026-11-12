import { describe, expect, test } from 'vitest';
import type { VehicleFinancing } from '#lib/types/index.ts';
import { calculateAmortizationSchedule } from '#lib/utils/financing-calculations.ts';

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

describe('calculateAmortizationSchedule — negative-amortization guard', () => {
	test('under-funded loan (payment < monthly interest) → no negative principal, non-increasing balance', () => {
		const schedule = calculateAmortizationSchedule(
			makeLoan({ originalAmount: 100_000, apr: 30, termMonths: 60, paymentAmount: 50 }),
			0
		);
		let prevBalance = 100_000;
		for (const row of schedule) {
			expect(row.principalAmount).toBeGreaterThan(0);
			expect(row.remainingBalance).toBeLessThanOrEqual(prevBalance + 1e-6);
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
