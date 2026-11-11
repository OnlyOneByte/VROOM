import { describe, expect, test } from 'vitest';
import { detectionOutcome } from '../import-detection';
import type { ImportMappingPreset } from '$lib/types/import-mapping';

const fuellyPreset: ImportMappingPreset = {
	id: 'fuelly',
	label: 'Fuelly',
	signature: ['date', 'odometer'],
	columns: { date: 'Date' },
	dateFormat: 'mdy'
};

const NATIVE_HEADERS = ['date', 'vehicle', 'category', 'amount'];
const FOREIGN_HEADERS = ['Transaction Date', 'Spent', 'Kind', 'Odometer'];

describe('detectionOutcome', () => {
	test('a detected preset with a single vehicle auto-targets it and needs no manual mapping', () => {
		expect(detectionOutcome(FOREIGN_HEADERS, fuellyPreset, ['v1'])).toEqual({
			targetVehicleId: 'v1',
			manualColumns: null
		});
	});

	test('a detected preset with several vehicles leaves the target for the user', () => {
		expect(detectionOutcome(FOREIGN_HEADERS, fuellyPreset, ['v1', 'v2'])).toEqual({
			targetVehicleId: '',
			manualColumns: null
		});
	});

	test('a native VROOM export imports as-is, even with a single vehicle, without auto-targeting', () => {
		expect(detectionOutcome(NATIVE_HEADERS, null, ['v1'])).toEqual({
			targetVehicleId: '',
			manualColumns: null
		});
	});

	test('an unrecognized file starts manual mapping seeded with column guesses', () => {
		const outcome = detectionOutcome(FOREIGN_HEADERS, null, ['v1']);

		expect(outcome.targetVehicleId).toBe('v1');
		expect(outcome.manualColumns).toEqual({
			date: 'Transaction Date',
			amount: 'Spent',
			category: 'Kind',
			mileage: 'Odometer'
		});
	});

	test('an unrecognized file with several or zero vehicles keeps the target empty', () => {
		expect(detectionOutcome(FOREIGN_HEADERS, null, ['v1', 'v2']).targetVehicleId).toBe('');
		expect(detectionOutcome(FOREIGN_HEADERS, null, []).targetVehicleId).toBe('');
		expect(detectionOutcome(FOREIGN_HEADERS, null, []).manualColumns).not.toBeNull();
	});
});
