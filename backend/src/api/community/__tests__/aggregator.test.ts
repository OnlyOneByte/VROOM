import { describe, expect, test } from 'bun:test';
import { ChargeUnit, DistanceUnit, VolumeUnit } from '../../../types';
import {
  ageBand,
  aggregate,
  type CommunityVehicle,
  noiseScaleFor,
  premiumInWindow,
  vehicleSamples,
} from '../aggregator';
import { fillUps, NO_NOISE, NOW, owners, vehicle } from './community-fixtures';

const DAY = 86_400_000;
const term = (startDays: number, endDays: number, amount: number) => ({
  amount,
  termStart: new Date(NOW.getTime() + startDays * DAY),
  termEnd: new Date(NOW.getTime() + endDays * DAY),
});
const OPTIONS = { now: NOW, minGroup: 10, uniform: NO_NOISE };
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

  test('a bucket publishes only its mean, at any size, and n is rounded down to a multiple of 5', () => {
    for (const [count, published] of [
      [13, 10],
      [22, 20],
      [60, 60],
    ] as const) {
      const row = efficiencyRow(owners(count).map((id) => vehicle(id)));
      expect(row?.nPublished).toBe(published);
      expect(Object.keys(row ?? {}).filter((key) => /^p\d+$/.test(key))).toEqual([]);
      expect(row?.mean).toBeCloseTo(Math.round(CIVIC_KM_PER_L * 10) / 10, 6);
    }
  });

  test('each bucket takes exactly one noise draw per refresh, spending ε = 1 on its mean', () => {
    let draws = 0;
    const uniform = () => {
      draws++;
      return 0.5;
    };
    const result = aggregate(
      owners(30).map((id) => vehicle(id)),
      { ...OPTIONS, uniform }
    );
    expect(result.rows.length).toBeGreaterThan(0);
    expect(draws).toBe(result.rows.length);
  });

  test('the published mean is the true mean plus one Laplace draw at the published-n scale', () => {
    const u = 0.9;
    const row = efficiencyRow(
      owners(12).map((id) => vehicle(id)),
      { ...OPTIONS, uniform: () => u }
    );
    const scale = (60 - 2) / 10;
    const noise = -scale * Math.sign(u - 0.5) * Math.log(1 - 2 * Math.abs(u - 0.5));
    expect(row?.mean).toBeCloseTo(Math.round((CIVIC_KM_PER_L + noise) * 10) / 10, 6);
  });

  test('the noise scale is the band width over the published n', () => {
    expect(noiseScaleFor({ lo: 2, hi: 60 }, 10)).toBeCloseTo(5.8, 9);
    expect(noiseScaleFor({ lo: 2, hi: 60 }, 100)).toBeCloseTo(0.58, 9);
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
  });

  test('published values are rounded to their step and never reveal exact n', () => {
    const vehicles = owners(23).map((id) => vehicle(id));
    for (const row of aggregate(vehicles, OPTIONS).rows) {
      expect(row.nPublished % 5).toBe(0);
      const step = row.unit === 'cents_per_year' ? 1000 : 0.1;
      expect(Math.abs(row.mean / step - Math.round(row.mean / step))).toBeLessThan(1e-6);
    }
  });

  test('noise moves the mean but keeps it inside the plausibility band', () => {
    let i = 0;
    const draws = [0.99, 0.01, 0.7, 0.2];
    const uniform = () => draws[i++ % draws.length] ?? 0.5;
    const row = efficiencyRow(
      owners(20).map((id) => vehicle(id)),
      { ...OPTIONS, uniform }
    );
    expect(row).toBeDefined();
    expect(row?.mean).toBeGreaterThanOrEqual(2);
    expect(row?.mean).toBeLessThanOrEqual(60);
    expect(row?.mean).not.toBeCloseTo(Math.round(CIVIC_KM_PER_L * 10) / 10, 3);
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
    const recent = vehicle('recent', {
      firstRecordAt: new Date(NOW.getTime() - 30 * 86_400_000),
      region: 'US-CA',
      insurancePremiums: [term(-30, 335, 90_000)],
    });
    const recentMetrics = vehicleSamples(recent, NOW).map((s) => s.metric);
    expect(recentMetrics).not.toContain('maintenance');
    expect(recentMetrics).not.toContain('insurance');

    const insured = (region: string | null) =>
      vehicle('insured', {
        region,
        insurancePremiums: [
          {
            amount: 90_000,
            termStart: new Date(NOW.getTime() - 300 * DAY),
            termEnd: new Date(NOW.getTime() + 65 * DAY),
          },
        ],
      });
    expect(vehicleSamples(insured(null), NOW).map((s) => s.metric)).not.toContain('insurance');
    const premium = vehicleSamples(insured('US-CA'), NOW).find((s) => s.metric === 'insurance');
    expect(premium?.value).toBeCloseTo(90_000 * (300 / 365), 6);
    expect(premium?.bucketKey).toBe('insurance|USD|US-CA|6-9');
  });

  test.each([
    ['a single 6-month term inside the window', [term(-200, -17, 45_000)], 45_000],
    [
      'a 12-month term that began before the window',
      [term(-500, -135, 90_000)],
      90_000 * (230 / 365),
    ],
    [
      'two 6-month terms back to back',
      [term(-365, -182.5, 45_000), term(-182.5, 0, 45_000)],
      90_000,
    ],
    ['a 3-year term', [term(-500, 595, 270_000)], 270_000 * (365 / 1095)],
    ['a term that ended before the window', [term(-800, -400, 90_000)], 0],
  ])('insurance per year counts %s by its share of the window', (_label, premiums, expected) => {
    expect(premiumInWindow(premiums, NOW)).toBeCloseTo(expected, 3);
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
