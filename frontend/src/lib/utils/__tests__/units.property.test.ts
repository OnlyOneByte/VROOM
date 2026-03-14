// Feature: unit-aware-display, Property 10: Label function output correctness

import { describe, expect, test } from 'vitest';
import fc from 'fast-check';
import type { ChargeUnit, DistanceUnit, VolumeUnit } from '$lib/types';
import {
	getChargeUnitLabel,
	getCostPerDistanceLabel,
	getDistanceUnitLabel,
	getElectricEfficiencyLabel,
	getFuelEfficiencyLabel,
	getLongFormLabel,
	getVolumeUnitLabel
} from '$lib/utils/units';

const DISTANCE_UNITS: DistanceUnit[] = ['miles', 'kilometers'];
const VOLUME_UNITS: VolumeUnit[] = ['gallons_us', 'gallons_uk', 'liters'];
const CHARGE_UNITS: ChargeUnit[] = ['kwh'];
const ALL_UNITS: (DistanceUnit | VolumeUnit | ChargeUnit)[] = [
	...DISTANCE_UNITS,
	...VOLUME_UNITS,
	...CHARGE_UNITS
];

const distanceUnitArb = fc.constantFrom<DistanceUnit>(...DISTANCE_UNITS);
const volumeUnitArb = fc.constantFrom<VolumeUnit>(...VOLUME_UNITS);
const chargeUnitArb = fc.constantFrom<ChargeUnit>(...CHARGE_UNITS);
const allUnitArb = fc.constantFrom<DistanceUnit | VolumeUnit | ChargeUnit>(...ALL_UNITS);

const EXPECTED_SHORT_DISTANCE: Record<DistanceUnit, string> = {
	miles: 'mi',
	kilometers: 'km'
};

const EXPECTED_SHORT_VOLUME: Record<VolumeUnit, string> = {
	gallons_us: 'gal',
	gallons_uk: 'gal',
	liters: 'L'
};

const EXPECTED_SHORT_CHARGE: Record<ChargeUnit, string> = {
	kwh: 'kWh'
};

// ---------------------------------------------------------------------------
// Property 10: Label function output correctness
// **Validates: Requirements 4.3, 4.4, 4.5, 4.6**
// ---------------------------------------------------------------------------
describe('Property 10: Label function output correctness', () => {
	test('getDistanceUnitLabel(d, true) produces correct short labels for all distance units', () => {
		fc.assert(
			fc.property(distanceUnitArb, unit => {
				expect(getDistanceUnitLabel(unit, true)).toBe(EXPECTED_SHORT_DISTANCE[unit]);
			}),
			{ numRuns: 100 }
		);
	});

	test('getVolumeUnitLabel(v, true) produces correct short labels for all volume units', () => {
		fc.assert(
			fc.property(volumeUnitArb, unit => {
				expect(getVolumeUnitLabel(unit, true)).toBe(EXPECTED_SHORT_VOLUME[unit]);
			}),
			{ numRuns: 100 }
		);
	});

	test('getChargeUnitLabel(c, true) produces correct short labels for all charge units', () => {
		fc.assert(
			fc.property(chargeUnitArb, unit => {
				expect(getChargeUnitLabel(unit, true)).toBe(EXPECTED_SHORT_CHARGE[unit]);
			}),
			{ numRuns: 100 }
		);
	});

	test('getFuelEfficiencyLabel(d, v) equals getDistanceUnitLabel(d, true) + "/" + getVolumeUnitLabel(v, true)', () => {
		fc.assert(
			fc.property(distanceUnitArb, volumeUnitArb, (d, v) => {
				const expected = `${getDistanceUnitLabel(d, true)}/${getVolumeUnitLabel(v, true)}`;
				expect(getFuelEfficiencyLabel(d, v)).toBe(expected);
			}),
			{ numRuns: 100 }
		);
	});

	test('getElectricEfficiencyLabel(d, c) equals getDistanceUnitLabel(d, true) + "/" + getChargeUnitLabel(c, true)', () => {
		fc.assert(
			fc.property(distanceUnitArb, chargeUnitArb, (d, c) => {
				const expected = `${getDistanceUnitLabel(d, true)}/${getChargeUnitLabel(c, true)}`;
				expect(getElectricEfficiencyLabel(d, c)).toBe(expected);
			}),
			{ numRuns: 100 }
		);
	});

	test('getCostPerDistanceLabel(d) produces "Cost/" + getDistanceUnitLabel(d, true)', () => {
		fc.assert(
			fc.property(distanceUnitArb, d => {
				expect(getCostPerDistanceLabel(d)).toBe(`Cost/${getDistanceUnitLabel(d, true)}`);
			}),
			{ numRuns: 100 }
		);
	});

	test('getLongFormLabel(unit) produces non-empty strings for all valid units', () => {
		fc.assert(
			fc.property(allUnitArb, unit => {
				const label = getLongFormLabel(unit);
				expect(typeof label).toBe('string');
				expect(label.length).toBeGreaterThan(0);
			}),
			{ numRuns: 100 }
		);
	});
});
