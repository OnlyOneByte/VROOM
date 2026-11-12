import { describe, expect, test } from 'vitest';
import { getVehicleDisplayName } from '../vehicle-helpers';

describe('getVehicleDisplayName', () => {
	test('nickname wins when set (the user-chosen label)', () => {
		expect(
			getVehicleDisplayName({ year: 2021, make: 'Ford', model: 'F-150', nickname: 'Daily Driver' })
		).toBe('Daily Driver');
	});

	test('falls back to "year make model" when no nickname', () => {
		expect(getVehicleDisplayName({ year: 2021, make: 'Ford', model: 'F-150' })).toBe(
			'2021 Ford F-150'
		);
	});

	test('an empty-string nickname falls through to "year make model" (|| is falsy-checked)', () => {
		expect(
			getVehicleDisplayName({ year: 2020, make: 'Toyota', model: 'Camry', nickname: '' })
		).toBe('2020 Toyota Camry');
	});

	test('null vehicle → "Unknown Vehicle" (deleted-vehicle fallback, never dereferences null)', () => {
		expect(getVehicleDisplayName(null)).toBe('Unknown Vehicle');
	});

	test('undefined vehicle → "Unknown Vehicle" (transient/loading data)', () => {
		expect(getVehicleDisplayName(undefined)).toBe('Unknown Vehicle');
	});
});
