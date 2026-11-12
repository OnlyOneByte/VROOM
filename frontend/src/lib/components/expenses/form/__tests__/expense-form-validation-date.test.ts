import { describe, expect, test } from 'vitest';
import type { Vehicle } from '$lib/types';
import { validateExpenseField } from '../expense-form-validation';

function localToday(): string {
	const n = new Date();
	return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
}

function shiftDays(ymd: string, days: number): string {
	const parts = ymd.split('-').map(Number);
	const y = parts[0] ?? 1970;
	const m = parts[1] ?? 1;
	const d = parts[2] ?? 1;
	const dt = new Date(y, m - 1, d + days);
	return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

function ctxWithDate(date: string) {
	return {
		category: 'misc',
		vehicle: null as Vehicle | null,
		volumeUnit: 'liters' as const,
		chargeUnit: 'kwh' as const,
		allVehicleExpenses: [],
		formData: { date } as Record<string, string | string[]>
	};
}

describe('validateExpenseField — date (timezone-safe future check)', () => {
	test("today's local date is accepted (not rejected as future)", () => {
		expect(validateExpenseField('date', ctxWithDate(localToday()))).toBeNull();
	});

	test('yesterday (a past date) is accepted', () => {
		expect(validateExpenseField('date', ctxWithDate(shiftDays(localToday(), -1)))).toBeNull();
	});

	test('a clearly past date is accepted', () => {
		expect(validateExpenseField('date', ctxWithDate('2020-01-15'))).toBeNull();
	});

	test('tomorrow (a future date) is rejected', () => {
		expect(validateExpenseField('date', ctxWithDate(shiftDays(localToday(), 1)))).toBe(
			'Date cannot be in the future'
		);
	});

	test('a far-future date is rejected', () => {
		expect(validateExpenseField('date', ctxWithDate('2999-12-31'))).toBe(
			'Date cannot be in the future'
		);
	});

	test('an empty date is required', () => {
		expect(validateExpenseField('date', ctxWithDate(''))).toBe('Date is required');
	});
});
