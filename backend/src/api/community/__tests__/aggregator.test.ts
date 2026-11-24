import { describe, expect, test } from 'bun:test';
import { ChargeUnit, DistanceUnit, VolumeUnit } from '../../../types';
import { ageBand, aggregate, type CommunityVehicle, vehicleSamples } from '../aggregator';
import { fillUps, NO_NOISE, NOW, owners, vehicle } from './community-fixtures';

const OPTIONS = { now: NOW, minGroup: 10, quartileMinGroup: 20, uniform: NO_NOISE };
const CIVIC_KM_PER_L = (300 * 1.609344) / (10 * 3.785411784);

function efficiencyRow(vehicles: CommunityVehicle[], options = OPTIONS) {
  return aggregate(vehicles, options).rows.find((row) => row.metric === 'efficiency');
}

describe('community stats aggregation privacy', () => {
  test('a bucket with fewer than 10 owners is suppressed and 10 is published', () => {
    const nine = owners(9).map((id) => vehicle(id));
    expect(efficiencyRow(nine)).toBeUndefined();
    expect(aggregate(nine, OPTIONS).suppressed).toBeGreaterThan(0);

    const ten = owners(10).map((id) => vehicle(id));
    const row = efficiencyRow(ten);
    expect(row?.nPublished).toBe(10);
    expect(row?.bucketKey).toBe('efficiency|honda-civic|2019|gas');
  });

  test('a five-car household counts as one owner', () => {
    const household = Array.from({ length: 5 }, () => vehicle('family'));
    const vehicles = [...household, ...owners(8).map((id) => vehicle(id))];
    expect(vehicles).toHaveLength(13);
    expect(efficiencyRow(vehicles)).toBeUndefined();
    expect(efficiencyRow([...vehicles, vehicle('one-more')])?.nPublished).toBe(10);
  });

  test('quartiles appear only from 20 owners, and n is rounded down to a multiple of 5', () => {
    const thirteen = efficiencyRow(owners(13).map((id) => vehicle(id)));
    expect(thirteen?.nPublished).toBe(10);
    expect(thirteen?.p25).toBeNull();
    expect(thirteen?.p75).toBeNull();

    const twentyTwo = efficiencyRow(owners(22).map((id) => vehicle(id)));
    expect(twentyTwo?.nPublished).toBe(20);
    expect(twentyTwo?.p25).not.toBeNull();
    expect(twentyTwo?.p75).not.toBeNull();
  });

  test('a raised minimum group size is respected, and published n never falls below it', () => {
    const twelve = owners(12).map((id) => vehicle(id));
    expect(efficiencyRow(twelve, { ...OPTIONS, minGroup: 15 })).toBeUndefined();
    expect(efficiencyRow(twelve, { ...OPTIONS, minGroup: 12 })).toBeUndefined();
    const fifteen = owners(15).map((id) => vehicle(id));
    expect(efficiencyRow(fifteen, { ...OPTIONS, minGroup: 12 })?.nPublished).toBe(15);
  });

  test('the noise depends only on the published n, not the exact n', () => {
    const fixed = () => 0.9;
    const ten = efficiencyRow(
      owners(10).map((id) => vehicle(id)),
      { ...OPTIONS, uniform: fixed }
    );
    const fourteen = efficiencyRow(
      owners(14).map((id) => vehicle(id)),
      { ...OPTIONS, uniform: fixed }
    );
    expect(ten?.mean).not.toBeCloseTo(Math.round(CIVIC_KM_PER_L * 10) / 10, 3);
    expect(fourteen?.mean).toBe(ten?.mean as number);
    expect(fourteen?.p50).toBe(ten?.p50 as number);
  });

  test('published values are rounded to their step and never reveal exact n', () => {
    const vehicles = owners(23).map((id) => vehicle(id));
    for (const row of aggregate(vehicles, OPTIONS).rows) {
      expect(row.nPublished % 5).toBe(0);
      const step = row.unit === 'cents_per_year' ? 1000 : 0.1;
      for (const value of [row.mean, row.p25, row.p50, row.p75]) {
        if (value === null || value === undefined) continue;
        expect(Math.abs(value / step - Math.round(value / step))).toBeLessThan(1e-6);
      }
    }
    expect(efficiencyRow(vehicles)?.p50).toBeCloseTo(Math.round(CIVIC_KM_PER_L * 10) / 10, 6);
  });

  test('noise moves values but keeps them inside the plausibility band and in order', () => {
    let i = 0;
    const draws = [0.99, 0.01, 0.7, 0.2];
    const uniform = () => draws[i++ % draws.length] ?? 0.5;
    const row = efficiencyRow(
      owners(20).map((id) => vehicle(id)),
      { ...OPTIONS, uniform }
    );
    expect(row).toBeDefined();
    for (const value of [row?.mean, row?.p25, row?.p50, row?.p75]) {
      expect(value).toBeGreaterThanOrEqual(2);
      expect(value).toBeLessThanOrEqual(60);
    }
    expect(row?.p25 ?? 0).toBeLessThanOrEqual(row?.p50 ?? 0);
    expect(row?.p50 ?? 0).toBeLessThanOrEqual(row?.p75 ?? 0);
  });

  test('values outside the plausibility band are dropped before counting', () => {
    const pricey = owners(10).map((id) =>
      vehicle(id, {
        expenses: fillUps({}).map((expense, index) =>
          index === 0 ? { ...expense, category: 'maintenance', expenseAmount: 3_000_000 } : expense
        ),
      })
    );
    const rows = aggregate(pricey, OPTIONS).rows;
    expect(rows.find((row) => row.metric === 'maintenance')).toBeUndefined();
  });

  test('rows carry no owner or vehicle identifiers', () => {
    const rows = aggregate(
      owners(10).map((id) => vehicle(id)),
      OPTIONS
    ).rows;
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      const text = JSON.stringify(row);
      expect(text).not.toContain('owner-');
      expect(Object.keys(row)).not.toContain('userId');
    }
  });
});

describe('per-vehicle samples', () => {
  test('mixed-unit vehicles land in the same canonical km/L value', () => {
    const us = vehicle('us');
    const metric = vehicle('metric', {
      units: {
        distanceUnit: DistanceUnit.KILOMETERS,
        volumeUnit: VolumeUnit.LITERS,
        chargeUnit: ChargeUnit.KWH,
      },
      expenses: fillUps({ distance: 300 * 1.609344, volume: 10 * 3.785411784 }),
    });
    const uk = vehicle('uk', {
      units: {
        distanceUnit: DistanceUnit.MILES,
        volumeUnit: VolumeUnit.GALLONS_UK,
        chargeUnit: ChargeUnit.KWH,
      },
      expenses: fillUps({ volume: (10 * 3.785411784) / 4.54609 }),
    });
    for (const v of [us, metric, uk]) {
      const sample = vehicleSamples(v, NOW).find((s) => s.metric === 'efficiency');
      expect(sample?.unit).toBe('km_per_l');
      expect(sample?.value).toBeCloseTo(CIVIC_KM_PER_L, 6);
    }
  });

  test('an electric vehicle reports km per kWh from its charging sessions', () => {
    const ev = vehicle('ev', {
      vehicleType: 'electric',
      catalogModelId: 'tesla-model-3',
      expenses: fillUps({ distance: 100, volume: 25, fuelType: 'Level 2 (AC)' }),
    });
    const sample = vehicleSamples(ev, NOW).find((s) => s.metric === 'efficiency');
    expect(sample?.unit).toBe('km_per_kwh');
    expect(sample?.value).toBeCloseTo((100 * 1.609344) / 25, 6);
  });

  test('a hybrid counts its liquid fuel only', () => {
    const liquid = fillUps({});
    const charges = fillUps({ distance: 30, volume: 8, fuelType: 'Level 2 (AC)' }).map(
      (expense) => ({ ...expense, date: new Date(expense.date.getTime() + 3_600_000) })
    );
    const hybrid = vehicle('phev', { vehicleType: 'hybrid', expenses: [...liquid, ...charges] });
    const sample = vehicleSamples(hybrid, NOW).find((s) => s.metric === 'efficiency');
    expect(sample?.unit).toBe('km_per_l');
    expect(sample?.value).toBeCloseTo(CIVIC_KM_PER_L, 6);
  });

  test('a vehicle with no recent records is not treated as owned for the whole window', () => {
    const idle = vehicle('idle', { lastRecordAt: new Date(NOW.getTime() - 200 * 86_400_000) });
    expect(vehicleSamples(idle, NOW).map((s) => s.metric)).not.toContain('maintenance');
  });

  test('fewer than 3 valid intervals gives no efficiency value', () => {
    const short = vehicle('short', { expenses: fillUps({ count: 3 }) });
    expect(vehicleSamples(short, NOW).some((s) => s.metric === 'efficiency')).toBe(false);
  });

  test('a vehicle without a catalogue model still counts for cost metrics only', () => {
    const samples = vehicleSamples(vehicle('free', { catalogModelId: null }), NOW);
    expect(samples.map((s) => s.metric).sort()).toEqual(['maintenance', 'running_cost']);
  });

  test('running cost needs 500 km and divides fuel plus maintenance by distance', () => {
    const tooShort = vehicle('short', { expenses: fillUps({ distance: 50 }) });
    expect(vehicleSamples(tooShort, NOW).some((s) => s.metric === 'running_cost')).toBe(false);
    const running = vehicleSamples(vehicle('long'), NOW).find((s) => s.metric === 'running_cost');
    expect(running?.value).toBeCloseTo((6 * 4000) / (5 * 300 * 1.609344), 6);
    expect(running?.bucketKey).toBe('running_cost|gas|USD|-');
  });

  test('maintenance and insurance need the whole window, and insurance needs a region', () => {
    const recent = vehicle('recent', { firstRecordAt: new Date(NOW.getTime() - 30 * 86_400_000) });
    expect(vehicleSamples(recent, NOW).map((s) => s.metric)).not.toContain('maintenance');

    const insured = (region: string | null) =>
      vehicle('insured', {
        region,
        expenses: [
          ...fillUps({}),
          {
            date: new Date(NOW.getTime() - 86_400_000),
            category: 'financial',
            expenseAmount: 90_000,
            mileage: null,
            volume: null,
            fuelType: null,
            missedFillup: false,
            sourceType: 'insurance_term',
          },
        ],
      });
    expect(vehicleSamples(insured(null), NOW).map((s) => s.metric)).not.toContain('insurance');
    const premium = vehicleSamples(insured('US-CA'), NOW).find((s) => s.metric === 'insurance');
    expect(premium?.value).toBe(90_000);
    expect(premium?.bucketKey).toBe('insurance|USD|US-CA|6-9');
  });

  test.each([
    [2026, '0-2'],
    [2024, '0-2'],
    [2023, '3-5'],
    [2017, '6-9'],
    [2012, '10-14'],
    [2011, '15+'],
    [1960, '15+'],
  ])('model year %p is in age band %p', (year, band) => {
    expect(ageBand(year, NOW)).toBe(band);
  });
});
