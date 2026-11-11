// Unit preferences schema, and mergeUnitPreferences: undefined when there is nothing to merge, and
// a null existing value is spread safely.

import { describe, expect, test } from 'bun:test';
import { ChargeUnit, DistanceUnit, type UnitPreferences, VolumeUnit } from '../../types';
import {
  mergeUnitPreferences,
  partialUnitPreferencesSchema,
  unitPreferencesSchema,
} from '../unit-preferences-schema';

const FULL: UnitPreferences = {
  distanceUnit: DistanceUnit.MILES,
  volumeUnit: VolumeUnit.GALLONS_US,
  chargeUnit: ChargeUnit.KWH,
};

describe('unitPreferencesSchema', () => {
  test('accepts a complete, valid object', () => {
    expect(unitPreferencesSchema.parse(FULL)).toEqual(FULL);
  });

  test('rejects an invalid enum value', () => {
    expect(() => unitPreferencesSchema.parse({ ...FULL, distanceUnit: 'furlongs' })).toThrow();
  });

  test('the FULL schema rejects a missing field; the PARTIAL schema accepts it', () => {
    const missingCharge = { distanceUnit: DistanceUnit.MILES, volumeUnit: VolumeUnit.LITERS };
    expect(() => unitPreferencesSchema.parse(missingCharge)).toThrow();
    expect(partialUnitPreferencesSchema.parse(missingCharge)).toEqual(missingCharge);
    expect(partialUnitPreferencesSchema.parse({})).toEqual({});
  });
});

describe('mergeUnitPreferences', () => {
  test('returns undefined when there is no partial to merge (leave the column untouched)', () => {
    expect(mergeUnitPreferences(FULL, undefined)).toBeUndefined();
  });

  test('overrides only the fields present in the partial, preserving the rest', () => {
    const merged = mergeUnitPreferences(FULL, { volumeUnit: VolumeUnit.LITERS });
    expect(merged).toEqual({
      distanceUnit: DistanceUnit.MILES,
      volumeUnit: VolumeUnit.LITERS,
      chargeUnit: ChargeUnit.KWH,
    });
  });

  test('a null or undefined existing value is spread safely', () => {
    // The return is typed UnitPreferences, so the partial expectations are cast.
    expect(mergeUnitPreferences(null, { distanceUnit: DistanceUnit.KILOMETERS })).toEqual({
      distanceUnit: DistanceUnit.KILOMETERS,
    } as UnitPreferences);
    expect(mergeUnitPreferences(undefined, { chargeUnit: ChargeUnit.KWH })).toEqual({
      chargeUnit: ChargeUnit.KWH,
    } as UnitPreferences);
  });

  test('a full partial replaces every field', () => {
    const allMetric: UnitPreferences = {
      distanceUnit: DistanceUnit.KILOMETERS,
      volumeUnit: VolumeUnit.LITERS,
      chargeUnit: ChargeUnit.KWH,
    };
    expect(mergeUnitPreferences(FULL, allMetric)).toEqual(allMetric);
  });
});
