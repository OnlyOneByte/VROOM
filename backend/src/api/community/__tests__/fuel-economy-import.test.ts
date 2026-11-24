import { describe, expect, test } from 'bun:test';
import { isCatalogModel } from '../../../utils/vehicle-catalog';
import { PLAUSIBLE_BANDS } from '../aggregator';
import { type FuelEconomyRow, formatRatings, ratingsFromRows } from '../fuel-economy-import';
import SHIPPED from '../fuel-economy-ratings.json';

const row = (overrides: Partial<FuelEconomyRow>): FuelEconomyRow => ({
  year: '2019',
  make: 'Honda',
  baseModel: 'Civic',
  atvType: '',
  comb08: '30',
  combE: '0',
  ...overrides,
});

describe('fuel economy ratings import', () => {
  test('keeps the lowest and highest combined rating per model, year and powertrain, in km/L', () => {
    expect(
      ratingsFromRows([
        row({ comb08: '30' }),
        row({ comb08: '36' }),
        row({ comb08: '25', baseModel: 'Civic Type R' }),
        row({ atvType: 'Hybrid', comb08: '47' }),
        row({ year: '2020', comb08: '33' }),
      ])
    ).toEqual({
      'honda-civic|2019|gas': [10.63, 15.31],
      'honda-civic|2019|hybrid': [19.98, 19.98],
      'honda-civic|2020|gas': [14.03, 14.03],
    });
  });

  test('electric ratings become km/kWh, and unknown models or fuels are left out', () => {
    expect(
      ratingsFromRows([
        row({ make: 'Tesla', baseModel: 'Model 3', atvType: 'EV', comb08: '132', combE: '25' }),
        row({ make: 'Nobody', baseModel: 'Thing' }),
        row({ atvType: 'CNG', comb08: '31' }),
        row({ comb08: '0' }),
      ])
    ).toEqual({ 'tesla-model-3|2019|electric': [6.44, 6.44] });
  });

  test('the written file parses back to the same ratings, one line per entry', () => {
    const output = {
      source: 's',
      license: 'l',
      retrieved: '2026-11-24',
      ratings: {
        'a|2019|gas': [1, 2] as [number, number],
        'b|2020|hybrid': [3, 4] as [number, number],
      },
    };
    const text = formatRatings(output);
    expect(JSON.parse(text)).toEqual(output);
    expect(text.split('\n').filter((line) => line.includes('|'))).toHaveLength(2);
  });

  test('the shipped ratings name catalogue models, a source and a date, and sit inside the wide bands', () => {
    expect(SHIPPED.source).toContain('fueleconomy.gov');
    expect(SHIPPED.retrieved).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    for (const [key, [min, max]] of Object.entries(SHIPPED.ratings as Record<string, number[]>)) {
      const [modelId, year, vehicleType] = key.split('|');
      expect(isCatalogModel(modelId ?? '')).toBe(true);
      expect(Number(year)).toBeGreaterThan(1980);
      const band = PLAUSIBLE_BANDS[vehicleType === 'electric' ? 'km_per_kwh' : 'km_per_l'];
      expect(min).toBeGreaterThan(band.lo);
      expect(max).toBeLessThan(band.hi);
      expect(min).toBeLessThanOrEqual(max as number);
    }
  });
});
