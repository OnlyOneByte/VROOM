import { describe, expect, test } from 'bun:test';
import { ChargeUnit, DistanceUnit, type UnitPreferences, VolumeUnit } from '../../../types';
import { toDisplayUnits, usefulEnough } from '../routes';

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

  test('every conversion keeps values in order', () => {
    for (const to of [US, UK, METRIC]) {
      for (const unit of ['km_per_l', 'km_per_kwh', 'cents_per_km', 'cents_per_year'] as const) {
        const [low, mid, high] = [10, 12, 14].map((value) => toDisplayUnits(value, unit, to));
        expect(low).toBeLessThan(mid as number);
        expect(mid).toBeLessThan(high as number);
      }
    }
  });
});

describe('an average is shown only when its noise is at most a quarter of it', () => {
  test.each([
    ['efficiency', 'km_per_l', 12, 35, false],
    ['efficiency', 'km_per_l', 12, 40, true],
    ['running_cost', 'cents_per_km', 9, 25, false],
    ['running_cost', 'cents_per_km', 9, 26, true],
    ['maintenance', 'cents_per_year', 60_000, 31, false],
    ['maintenance', 'cents_per_year', 60_000, 32, true],
    ['insurance', 'cents_per_year', 120_000, 37, false],
    ['insurance', 'cents_per_year', 120_000, 38, true],
    ['efficiency', 'km_per_l', 0, 1000, false],
  ] as const)('%s at mean %d with %d owners: %p', (metric, unit, mean, nPublished, expected) => {
    expect(usefulEnough({ mean, nPublished, currency: 'USD' }, metric, unit)).toBe(expected);
  });

  test('the same real cost needs the same number of owners in rupees as in dollars', () => {
    for (const [currency, mean] of [
      ['USD', 7.6],
      ['INR', 7.6 * 84],
    ] as const) {
      const row = (nPublished: number) => ({ mean, nPublished, currency });
      expect(usefulEnough(row(30), 'running_cost', 'cents_per_km')).toBe(false);
      expect(usefulEnough(row(31), 'running_cost', 'cents_per_km')).toBe(true);
    }
  });

  test('a money average in a currency with no range is never shown', () => {
    expect(
      usefulEnough({ mean: 50, nPublished: 1000, currency: 'ARS' }, 'running_cost', 'cents_per_km')
    ).toBe(false);
  });

  test("a rated model's narrow band is useful from a small group", () => {
    const civic = { catalogModelId: 'honda-civic', modelYear: 2019, vehicleType: 'gas' };
    expect(usefulEnough({ mean: 12.75, nPublished: 5, ...civic }, 'efficiency', 'km_per_l')).toBe(
      false
    );
    expect(usefulEnough({ mean: 12.75, nPublished: 10, ...civic }, 'efficiency', 'km_per_l')).toBe(
      true
    );
  });
});
