import type { TripPurpose } from '$lib/types';

export interface TripFormData {
	vehicleId: string;
	// Svelte binds number inputs as numbers at runtime; accept string, number or null.
	startOdometer: string | number | null;
	endOdometer: string | number | null;
	purpose: TripPurpose;
	tripDate: string;
	startLocation: string;
	endLocation: string;
	note: string;
}

export type TripFormErrors = Partial<Record<keyof TripFormData, string>>;

export function parseOdometer(raw: string | number | null | undefined): number | null {
	if (raw === null || raw === undefined) return null;
	const trimmed = typeof raw === 'string' ? raw.trim() : raw;
	if (trimmed === '') return null;
	const n = Number(trimmed);
	if (!Number.isInteger(n) || n < 0) return null;
	return n;
}

function isFutureLocalDay(dateOnly: string): boolean {
	const [y, m, d] = dateOnly.split('-').map(Number);
	if (!y || !m || !d) return false;
	const now = new Date();
	const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
	const picked = new Date(y, m - 1, d);
	return picked.getTime() > today.getTime();
}

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
