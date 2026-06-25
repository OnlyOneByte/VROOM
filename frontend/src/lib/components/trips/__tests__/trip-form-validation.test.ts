/**
 * Characterization net for the trip-form validator (trips-location T6b-2) — the PURE core of TripForm,
 * mirroring the backend createTripSchema so a submit that would 400 is caught client-side. Host-independent
 * (no store/DOM), the C125/C201 form-validator pattern.
 *
 * Pins: required-field presence (vehicle / odometer / date), the R2 end>=start rule (incl. the equal-allowed
 * boundary), the R5 future-guard on the LOCAL calendar day (today PASSES — the C226 lesson — tomorrow fails),
 * the max-length bounds on locations/note, and a fully-valid form → {}. The future cases are computed
 * relative to `now` so they hold on any host date/TZ.
 */

import { describe, expect, test } from 'vitest';
import { validateTripFields, type TripFormData } from '../trip-form-validation';

/** A date-only 'YYYY-MM-DD' offset from today by `days` (local calendar). */
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
		tripDate: localDateOffset(0), // today
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

	test('a trip dated TODAY is accepted (the C226 noon-local fix — not a future reject)', () => {
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

	test('requires a valid end odometer', () => {
		expect(validateTripFields(form({ endOdometer: '' })).endOdometer).toBeTruthy();
		expect(validateTripFields(form({ endOdometer: 'abc' })).endOdometer).toBeTruthy();
	});

	test('R2: rejects end < start with an endOdometer error', () => {
		const errors = validateTripFields(form({ startOdometer: '1080', endOdometer: '1000' }));
		expect(errors.endOdometer).toBeTruthy();
	});

	test('R2: end === start is allowed (a 0-distance trip is valid, e.g. round trip not logged)', () => {
		const errors = validateTripFields(form({ startOdometer: '1000', endOdometer: '1000' }));
		expect(errors.endOdometer).toBeUndefined();
	});

	test('R5: rejects a future local calendar day (tomorrow)', () => {
		const errors = validateTripFields(form({ tripDate: localDateOffset(1) }));
		expect(errors.tripDate).toBe('Trip date cannot be in the future');
	});

	test('R5: accepts a past day (yesterday)', () => {
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
