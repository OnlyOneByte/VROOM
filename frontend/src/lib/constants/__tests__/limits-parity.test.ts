import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { EXPENSE_LIMITS, TRIP_LIMITS, VEHICLE_LIMITS } from '../limits';

const SHARED_LIMITS_PATH = resolve(
	dirname(fileURLToPath(import.meta.url)),
	'../../../../../backend/src/shared-limits.json'
);

const SHARED_LIMITS = JSON.parse(readFileSync(SHARED_LIMITS_PATH, 'utf8')) as {
	vehicle: { minYear: number; maxYearsAhead: number; vinMinLength: number; vinMaxLength: number };
	expense: { maxAmount: number };
	trip: { noteMaxLength: number };
};

describe('input limits parity with the backend', () => {
	it('uses the backend vehicle limits', () => {
		expect(VEHICLE_LIMITS).toEqual({
			MIN_YEAR: SHARED_LIMITS.vehicle.minYear,
			MAX_YEARS_AHEAD: SHARED_LIMITS.vehicle.maxYearsAhead,
			VIN_MIN_LENGTH: SHARED_LIMITS.vehicle.vinMinLength,
			VIN_MAX_LENGTH: SHARED_LIMITS.vehicle.vinMaxLength
		});
	});

	it('uses the backend expense amount cap', () => {
		expect(EXPENSE_LIMITS.MAX_AMOUNT).toBe(SHARED_LIMITS.expense.maxAmount);
	});

	it('uses the backend trip note length', () => {
		expect(TRIP_LIMITS.NOTE_MAX_LENGTH).toBe(SHARED_LIMITS.trip.noteMaxLength);
	});
});
