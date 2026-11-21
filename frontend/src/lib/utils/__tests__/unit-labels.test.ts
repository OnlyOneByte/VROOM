import { describe, expect, test } from 'vitest';
import { getChargeUnitLabel, getDistanceUnitLabel, getVolumeUnitLabel } from '../units';

describe('unit labels', () => {
	test.each([
		['miles', 'mi', 'Miles'],
		['kilometers', 'km', 'Kilometers']
	] as const)('distance %s is %s short and %s long', (unit, short, long) => {
		expect(getDistanceUnitLabel(unit, true)).toBe(short);
		expect(getDistanceUnitLabel(unit)).toBe(long);
	});

	test.each([
		['gallons_us', 'gal', 'Gallons (US)'],
		['gallons_uk', 'gal', 'Gallons (UK)'],
		['liters', 'L', 'Liters']
	] as const)('volume %s is %s short and %s long', (unit, short, long) => {
		expect(getVolumeUnitLabel(unit, true)).toBe(short);
		expect(getVolumeUnitLabel(unit)).toBe(long);
	});

	test('charge kWh reads the same short and long', () => {
		expect(getChargeUnitLabel('kwh', true)).toBe('kWh');
		expect(getChargeUnitLabel('kwh')).toBe('kWh');
	});
});
