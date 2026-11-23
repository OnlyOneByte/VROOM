import { describe, expect, test } from 'vitest';
import { validateOdometerForm } from '#lib/utils/odometer-form-validation.ts';

const valid = { odometer: 12345, date: '2026-05-01', note: '' };

describe('validateOdometerForm', () => {
	test('a whole reading of 0 or more with a date passes, with or without a note', () => {
		expect(validateOdometerForm(valid)).toEqual({});
		expect(validateOdometerForm({ ...valid, odometer: 0 })).toEqual({});
		expect(validateOdometerForm({ ...valid, note: 'x'.repeat(500) })).toEqual({});
	});

	test.each([
		[undefined, 'Odometer reading is required'],
		[Number.NaN, 'Odometer reading is required'],
		[Number.POSITIVE_INFINITY, 'Odometer reading is required'],
		[-1, 'Odometer must be 0 or greater'],
		[-1.5, 'Odometer must be a whole number'],
		[1.5, 'Odometer must be a whole number'],
		[2 ** 53, 'Odometer must be a whole number']
	])('odometer %s: %s', (odometer, message) => {
		expect(validateOdometerForm({ ...valid, odometer })).toEqual({ odometer: message });
	});

	test('a missing date and a long note each get their own message', () => {
		expect(validateOdometerForm({ ...valid, date: '', note: 'x'.repeat(501) })).toEqual({
			date: 'Date is required',
			note: 'Note must be 500 characters or less'
		});
	});
});
