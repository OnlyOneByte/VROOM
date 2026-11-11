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
		startDate: new Date(2024, 4, 31) as unknown as string,
		paymentAmount: 500,
		paymentFrequency: 'monthly',
		isActive: true,
		createdAt: '2024-05-31T00:00:00.000Z',
		updatedAt: '2024-05-31T00:00:00.000Z',
		...overrides
	};
}

describe('calculatePayoffDate — lease end-date month-overflow clamp', () => {
	test('May 31 + 36 months clamps to May 31, 2027 (no overflow needed — May has 31 days)', () => {
		const end = calculatePayoffDate(makeLease({ termMonths: 36 }));
		expect(end.getFullYear()).toBe(2027);
		expect(end.getMonth()).toBe(4);
		expect(end.getDate()).toBe(31);
	});

	test('May 31 + 1 month clamps to Jun 30 — NOT rolled forward to Jul 1', () => {
		const end = calculatePayoffDate(makeLease({ termMonths: 1 }));
		expect(end.getMonth()).toBe(5);
		expect(end.getDate()).toBe(30);
	});

	test('Jan 31 + 1 month clamps to Feb 29 in a leap year — NOT Mar 2', () => {
		const end = calculatePayoffDate(
			makeLease({ startDate: new Date(2024, 0, 31) as unknown as string, termMonths: 1 })
		);
		expect(end.getMonth()).toBe(1);
		expect(end.getDate()).toBe(29);
	});

	test('Aug 31 + 13 months clamps to Sep 30, 2025 — a short target month after a year rollover', () => {
		const end = calculatePayoffDate(
			makeLease({ startDate: new Date(2024, 7, 31) as unknown as string, termMonths: 13 })
		);
		expect(end.getFullYear()).toBe(2025);
		expect(end.getMonth()).toBe(8);
		expect(end.getDate()).toBe(30);
	});

	test('a mid-month lease (15th) is unaffected — lands on the same day-of-month', () => {
		const end = calculatePayoffDate(
			makeLease({ startDate: new Date(2024, 2, 15) as unknown as string, termMonths: 24 })
		);
		expect(end.getFullYear()).toBe(2026);
		expect(end.getMonth()).toBe(2);
		expect(end.getDate()).toBe(15);
	});
});
