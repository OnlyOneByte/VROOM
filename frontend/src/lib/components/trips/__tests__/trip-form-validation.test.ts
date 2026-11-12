import { describe, expect, test } from 'vitest';
import { parseOdometer, validateTripFields, type TripFormData } from '../trip-form-validation';

function localDateOffset(days: number): string {
	const now = new Date();
	const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + days);
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, '0');
	const day = String(d.getDate()).padStart(2, '0');
	return `${y}-${m}-${day}`;
}

function form(overrides: Partial<TripFormData> = {}): TripFormData {
	return {
		vehicleId: 'v1',
		startOdometer: '1000',
		endOdometer: '1080',
		purpose: 'business',
		tripDate: localDateOffset(0),
		startLocation: '',
		endLocation: '',
		note: '',
		...overrides
	};
}

describe('validateTripFields', () => {
	test('a fully valid form (today) returns no errors', () => {
		expect(validateTripFields(form())).toEqual({});
	});

	test('a trip dated TODAY is accepted (the noon-local fix — not a future reject)', () => {
		const errors = validateTripFields(form({ tripDate: localDateOffset(0) }));
		expect(errors.tripDate).toBeUndefined();
	});

	test('requires a vehicle', () => {
		expect(validateTripFields(form({ vehicleId: '' })).vehicleId).toBeTruthy();
	});

	test('requires a valid start odometer (empty / negative / non-integer)', () => {
		expect(validateTripFields(form({ startOdometer: '' })).startOdometer).toBeTruthy();
		expect(validateTripFields(form({ startOdometer: '-5' })).startOdometer).toBeTruthy();
		expect(validateTripFields(form({ startOdometer: '12.5' })).startOdometer).toBeTruthy();
	});

	// Svelte binds number inputs as numbers or null at runtime.
	test('accepts NUMBER-typed odometers (the Svelte type=number coercion the live form sends)', () => {
		expect(validateTripFields(form({ startOdometer: 1000, endOdometer: 1080 }))).toEqual({});
	});

	test('treats a null odometer (cleared number input) as missing, not a crash', () => {
		const errors = validateTripFields(form({ startOdometer: null, endOdometer: null }));
		expect(errors.startOdometer).toBeTruthy();
		expect(errors.endOdometer).toBeTruthy();
	});

	test('end-before-start rule holds for mixed string and number odometers', () => {
		expect(
			validateTripFields(form({ startOdometer: 1080, endOdometer: '1000' })).endOdometer
		).toBeTruthy();
	});

	test('parseOdometer tolerates string | number | null (the exported submit-path parser)', () => {
		expect(parseOdometer('1000')).toBe(1000);
		expect(parseOdometer(1000)).toBe(1000);
		expect(parseOdometer(0)).toBe(0);
		expect(parseOdometer(null)).toBeNull();
		expect(parseOdometer('')).toBeNull();
		expect(parseOdometer(12.5)).toBeNull();
		expect(parseOdometer(-5)).toBeNull();
	});

	test('requires a valid end odometer', () => {
		expect(validateTripFields(form({ endOdometer: '' })).endOdometer).toBeTruthy();
		expect(validateTripFields(form({ endOdometer: 'abc' })).endOdometer).toBeTruthy();
	});

	test('rejects end before start with an endOdometer error', () => {
		const errors = validateTripFields(form({ startOdometer: '1080', endOdometer: '1000' }));
		expect(errors.endOdometer).toBeTruthy();
	});

	test('allows end equal to start (a zero-distance trip)', () => {
		const errors = validateTripFields(form({ startOdometer: '1000', endOdometer: '1000' }));
		expect(errors.endOdometer).toBeUndefined();
	});

	test('rejects a future local calendar day (tomorrow)', () => {
		const errors = validateTripFields(form({ tripDate: localDateOffset(1) }));
		expect(errors.tripDate).toBe('Trip date cannot be in the future');
	});

	test('accepts a past day (yesterday)', () => {
		expect(validateTripFields(form({ tripDate: localDateOffset(-1) })).tripDate).toBeUndefined();
	});

	test('requires a trip date', () => {
		expect(validateTripFields(form({ tripDate: '' })).tripDate).toBeTruthy();
	});

	test('bounds locations and note length', () => {
		expect(validateTripFields(form({ startLocation: 'x'.repeat(201) })).startLocation).toBeTruthy();
		expect(validateTripFields(form({ endLocation: 'y'.repeat(201) })).endLocation).toBeTruthy();
		expect(validateTripFields(form({ note: 'z'.repeat(501) })).note).toBeTruthy();
	});

	test('locations/note at the max length are allowed', () => {
		const errors = validateTripFields(
			form({ startLocation: 'x'.repeat(200), endLocation: 'y'.repeat(200), note: 'z'.repeat(500) })
		);
		expect(errors.startLocation).toBeUndefined();
		expect(errors.endLocation).toBeUndefined();
		expect(errors.note).toBeUndefined();
	});
});
