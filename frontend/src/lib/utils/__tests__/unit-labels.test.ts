import { describe, expect, test } from 'vitest';
import { getChargeUnitLabel, getDistanceUnitLabel, getVolumeUnitLabel } from '../units';

describe('long unit labels', () => {
	test.each([
		['miles', 'Miles'],
		['kilometers', 'Kilometers']
	] as const)('distance %s reads %s', (unit, long) => {
		expect(getDistanceUnitLabel(unit)).toBe(long);
	});

	test.each([
		['gallons_us', 'Gallons (US)'],
		['gallons_uk', 'Gallons (UK)'],
		['liters', 'Liters']
	] as const)('volume %s reads %s', (unit, long) => {
		expect(getVolumeUnitLabel(unit)).toBe(long);
	});

	test('charge kwh reads kWh', () => {
		expect(getChargeUnitLabel('kwh')).toBe('kWh');
	});
});
