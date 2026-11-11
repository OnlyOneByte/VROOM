import { describe, expect, test } from 'vitest';
import { dateOnlyToISO } from '$lib/utils/formatters';
import { createEmptyFormData, type ExpenseFormData } from '../expense-form-data';
import { buildExpenseData } from '../expense-payload';

const CTX = { currency: 'USD', sourceType: null, sourceId: null };

function filled(over: Partial<ExpenseFormData> = {}): ExpenseFormData {
	return {
		...createEmptyFormData(new Date('2026-03-01T12:00:00')),
		vehicleId: 'v1',
		category: 'fuel',
		amount: '42.50',
		mileage: '1300',
		volume: '10.5',
		charge: '',
		fuelType: '87 (Regular)',
		description: 'Shell',
		location: 'Main St',
		tags: ['fuel'],
		missedFillup: true,
		...over
	};
}

describe('buildExpenseData', () => {
	test('parses numeric text fields and carries the entry through', () => {
		expect(buildExpenseData(filled(), CTX)).toEqual({
			vehicleId: 'v1',
			tags: ['fuel'],
			category: 'fuel',
			amount: 42.5,
			date: dateOnlyToISO('2026-03-01'),
			mileage: 1300,
			volume: 10.5,
			charge: undefined,
			fuelType: '87 (Regular)',
			description: 'Shell',
			location: 'Main St',
			currency: 'USD',
			sourceType: undefined,
			sourceId: undefined,
			missedFillup: true
		});
	});

	test('empty optional fields become undefined rather than blank or zero', () => {
		const data = buildExpenseData(
			filled({ mileage: '', volume: '', charge: '', fuelType: '', description: '', location: '' }),
			CTX
		);
		expect(data.mileage).toBeUndefined();
		expect(data.volume).toBeUndefined();
		expect(data.charge).toBeUndefined();
		expect(data.fuelType).toBeUndefined();
		expect(data.description).toBeUndefined();
		expect(data.location).toBeUndefined();
	});

	test('the source link is attached when the entry came from a financing payment', () => {
		const data = buildExpenseData(filled({ category: 'financial' }), {
			currency: 'EUR',
			sourceType: 'financing',
			sourceId: 'loan-1'
		});
		expect(data).toMatchObject({ currency: 'EUR', sourceType: 'financing', sourceId: 'loan-1' });
	});
});
