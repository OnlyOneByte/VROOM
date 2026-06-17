/**
 * Unit tests for the shared unit-preferences schema + merge helper (C238 dedup). The schema +
 * partial-merge were byte-identical in vehicles/routes.ts and settings/routes.ts; this pins the
 * extracted single source of truth — especially mergeUnitPreferences's contracts (undefined when
 * nothing to merge; null/undefined existing spread safely; partial overrides existing field-by-field).
 */

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
      volumeUnit: VolumeUnit.LITERS, // overridden
      chargeUnit: ChargeUnit.KWH,
    });
  });

  test('a null/undefined existing is spread safely (the vehicle-path edge — existing may be null)', () => {
    // The settings path always has a full existing; the vehicle path could pass null. Both old inline
    // sites spread `...existing` so a null would have spread to {} — this preserves that exactly. The
    // return is typed UnitPreferences (the helper's `as` cast, matching the prior inline behavior), so
    // the expected partials are cast to compare structurally.
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
