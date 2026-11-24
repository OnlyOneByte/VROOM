import { describe, expect, test } from 'bun:test';
import { ChargeUnit, DistanceUnit, type UnitPreferences, VolumeUnit } from '../../../types';
import { toDisplayUnits } from '../routes';

const units = (distanceUnit: DistanceUnit, volumeUnit: VolumeUnit): UnitPreferences => ({
  distanceUnit,
  volumeUnit,
  chargeUnit: ChargeUnit.KWH,
});

const US = units(DistanceUnit.MILES, VolumeUnit.GALLONS_US);
const UK = units(DistanceUnit.MILES, VolumeUnit.GALLONS_UK);
const METRIC = units(DistanceUnit.KILOMETERS, VolumeUnit.LITERS);

describe('community values in display units', () => {
  test.each([
    [METRIC, 12.754, 12.754],
    [US, 12.754, 30],
    [UK, 12.754, 36.03],
  ])('km/L converts to the vehicle distance-per-volume unit', (to, kmPerL, expected) => {
    expect(toDisplayUnits(kmPerL, 'km_per_l', to)).toBeCloseTo(expected, 1);
  });

  test('km/kWh converts to miles per kWh for a miles vehicle', () => {
    expect(toDisplayUnits(6.4, 'km_per_kwh', US)).toBeCloseTo(6.4 / 1.609344, 6);
    expect(toDisplayUnits(6.4, 'km_per_kwh', METRIC)).toBe(6.4);
  });

  test('cents per km converts to cents per mile, and yearly cents stay as they are', () => {
    expect(toDisplayUnits(10, 'cents_per_km', US)).toBeCloseTo(16.09344, 6);
    expect(toDisplayUnits(10, 'cents_per_km', METRIC)).toBe(10);
    expect(toDisplayUnits(120_000, 'cents_per_year', US)).toBe(120_000);
  });

  test('every conversion keeps quartiles in order', () => {
    for (const to of [US, UK, METRIC]) {
      for (const unit of ['km_per_l', 'km_per_kwh', 'cents_per_km', 'cents_per_year'] as const) {
        const [p25, p50, p75] = [10, 12, 14].map((value) => toDisplayUnits(value, unit, to));
        expect(p25).toBeLessThan(p50 as number);
        expect(p50).toBeLessThan(p75 as number);
      }
    }
  });
});
