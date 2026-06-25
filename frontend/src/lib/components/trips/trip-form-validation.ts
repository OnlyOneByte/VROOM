import type { TripPurpose } from '$lib/types';

/**
 * Pure trip-form validation (trips-location T6b-2) — the testable core of TripForm, mirroring the backend
 * createTripSchema (backend/src/api/trips/validation.ts) so the form blocks BEFORE a 400 round-trip. Host-
 * independent (no store/DOM), the C125/C201 form-validator pattern.
 *
 * The form binds raw strings (an <input type="number"> yields a string; the DatePicker binds 'YYYY-MM-DD');
 * the validator parses + range-checks them and returns an errors map (empty = valid). It enforces the two
 * rules the user can get wrong:
 *   - R2: endOdometer >= startOdometer (a backwards trip is a data-entry error, not a 0-distance trip).
 *   - R5 future-guard: tripDate is not a future LOCAL CALENDAR DAY (the C226 fix — the form sends a date-only
 *     value the backend reads as noon-local, so "today" must always pass; only a calendar day AFTER today is
 *     rejected). Compared on local Y/M/D, matching backend notFutureLocalDay.
 */

export interface TripFormData {
	vehicleId: string;
	/** Raw <input> strings; parsed to non-negative integers here. */
	startOdometer: string;
	endOdometer: string;
	purpose: TripPurpose;
	/** 'YYYY-MM-DD' from the DatePicker. */
	tripDate: string;
	startLocation: string;
	endLocation: string;
	note: string;
}

export type TripFormErrors = Partial<Record<keyof TripFormData, string>>;

/** Parse a raw odometer string to a non-negative integer, or null when it isn't one. */
function parseOdometer(raw: string): number | null {
	const trimmed = raw.trim();
	if (trimmed === '') return null;
	const n = Number(trimmed);
	if (!Number.isInteger(n) || n < 0) return null;
	return n;
}

/**
 * Is `dateOnly` ('YYYY-MM-DD') a calendar day AFTER today's LOCAL day? Mirrors the backend's
 * notFutureLocalDay (compare local Y/M/D, not an absolute instant — the C226 lesson). Malformed input
 * is treated as "not future" (the required-presence check handles emptiness; format errors surface as a
 * backend 400 rather than a confusing client message).
 */
function isFutureLocalDay(dateOnly: string): boolean {
	const [y, m, d] = dateOnly.split('-').map(Number);
	if (!y || !m || !d) return false;
	const now = new Date();
	const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
	const picked = new Date(y, m - 1, d);
	return picked.getTime() > today.getTime();
}

/**
 * Validate the trip form. Returns an errors object keyed by field — empty means valid. Mirrors the
 * backend createTripSchema so a submit that would 400 is caught client-side with a field-anchored message.
 */
export function validateTripFields(form: TripFormData): TripFormErrors {
	const errors: TripFormErrors = {};

	if (!form.vehicleId) {
		errors.vehicleId = 'Select a vehicle';
	}

	const start = parseOdometer(form.startOdometer);
	if (start === null) {
		errors.startOdometer = 'Enter a valid start odometer';
	}

	const end = parseOdometer(form.endOdometer);
	if (end === null) {
		errors.endOdometer = 'Enter a valid end odometer';
	}

	// R2: end >= start (only when both parsed cleanly — else the per-field errors already fire).
	if (start !== null && end !== null && end < start) {
		errors.endOdometer = 'End odometer must be at least the start odometer';
	}

	if (!form.tripDate) {
		errors.tripDate = 'Pick a trip date';
	} else if (isFutureLocalDay(form.tripDate)) {
		errors.tripDate = 'Trip date cannot be in the future';
	}

	if (form.startLocation.length > 200) {
		errors.startLocation = 'Start location is too long (max 200)';
	}
	if (form.endLocation.length > 200) {
		errors.endLocation = 'End location is too long (max 200)';
	}
	if (form.note.length > 500) {
		errors.note = 'Note is too long (max 500)';
	}

	return errors;
}
