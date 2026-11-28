import { describe, expect, test } from 'bun:test';
import { ChargeUnit, DistanceUnit, VolumeUnit } from '../../../types';
import {
  type AggregateOptions,
  ageBand,
  aggregate,
  bandFor,
  COMMUNITY_SCHEMA_VERSION,
  type CommunityVehicle,
  EPSILON_COUNT,
  EPSILON_SUM,
  keyedUniform,
  MONEY_BANDS_USD_CENTS,
  moneyBand,
  noiseScaleFor,
  PLAUSIBLE_BANDS,
  premiumInWindow,
  vehicleSamples,
} from '../aggregator';
import { fillUps, NO_NOISE, NOW, owners, vehicle } from './community-fixtures';

const PUBLISHED_UNDER_VERSION_1 = { n: 35, mean: 12.3 };

const DAY = 86_400_000;
const term = (startDays: number, endDays: number, amount: number) => ({
  amount,
  termStart: new Date(NOW.getTime() + startDays * DAY),
  termEnd: new Date(NOW.getTime() + endDays * DAY),
});
const OPTIONS: AggregateOptions = { now: NOW, minGroup: 10, uniform: NO_NOISE };
const CIVIC_KM_PER_L = (300 * 1.609344) / (10 * 3.785411784);
const CIVIC_FIELDS = { catalogModelId: 'honda-civic', modelYear: 2019, vehicleType: 'gas' };

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

  test('a published bucket draws once for its count and once for its sum, a suppressed one only for its count', () => {
    const labels: string[] = [];
    const uniform = (label: string) => {
      labels.push(label);
      return 0.5;
    };
    const result = aggregate(
      [...owners(30).map((id) => vehicle(id)), vehicle('alone', { vehicleKind: 'motorcycle' })],
      { ...OPTIONS, uniform }
    );
    const kinds = labels.map((label) => label.split('|').at(-1));
    expect(kinds.filter((kind) => kind === 'sum')).toHaveLength(result.published);
    expect(kinds.filter((kind) => kind === 'count')).toHaveLength(
      result.published + result.suppressed
    );
    expect(result.suppressed).toBeGreaterThan(0);
  });

  test('the mean is lo plus the noisy sum over the noisy count, with ε = 0.5 for each', () => {
    const u = 0.9;
    const row = efficiencyRow(
      owners(12).map((id) => vehicle(id)),
      { ...OPTIONS, uniform: () => u }
    );
    const draw = -Math.log(1 - 2 * (u - 0.5));
    const noisyCount = 12 + (1 / EPSILON_COUNT) * draw;
    const stepRounded = Math.round(CIVIC_KM_PER_L * 10) / 10;
    const noisySum = 12 * (stepRounded - 8.5) + ((18.4 - 8.5) / EPSILON_SUM) * draw;
    expect(row?.nPublished).toBe(15);
    expect(row?.mean).toBeCloseTo(Math.round((8.5 + noisySum / noisyCount) * 10) / 10, 6);
  });

  test('a change in the band or the budget draws fresh noise even over the same data', () => {
    const labels: string[] = [];
    const record = (label: string) => {
      labels.push(label);
      return 0.5;
    };
    aggregate(
      owners(12).map((id) => vehicle(id)),
      { ...OPTIONS, uniform: record }
    );
    const civicCount = labels.find((l) => l.startsWith('efficiency|') && l.endsWith('|count'));
    expect(civicCount).toContain(`|8.5|18.4|${EPSILON_COUNT}|${EPSILON_SUM}|`);
  });

  test('whether a group is published, and the count it shows, come from the noisy count', () => {
    const twentyThree = owners(23).map((id) => vehicle(id));
    const lifted = (label: string) => (label.endsWith('|count') ? 0.99 : 0.5);
    const lowered = (label: string) => (label.endsWith('|count') ? 0.01 : 0.5);
    const lift = -(1 / EPSILON_COUNT) * Math.log(1 - 2 * 0.49);
    expect(23 + lift).toBeGreaterThan(30);
    expect(
      efficiencyRow(twentyThree, { ...OPTIONS, minGroup: 30, uniform: lifted })?.nPublished
    ).toBe(30);
    const thirtyTwo = owners(32).map((id) => vehicle(id));
    expect(efficiencyRow(thirtyTwo, { ...OPTIONS, minGroup: 30 })?.nPublished).toBe(30);
    expect(
      efficiencyRow(thirtyTwo, { ...OPTIONS, minGroup: 30, uniform: lowered })
    ).toBeUndefined();
  });

  test('a rated model is clipped to 20% beyond its public ratings, an unrated one to the wide band', () => {
    expect(bandFor('efficiency', 'km_per_l', CIVIC_FIELDS)).toEqual({
      lo: 8.5,
      hi: 18.4,
      step: 0.1,
    });
    expect(
      bandFor('efficiency', 'km_per_l', { ...CIVIC_FIELDS, catalogModelId: 'audi-a1' })
    ).toEqual(PLAUSIBLE_BANDS.km_per_l);
    expect(bandFor('efficiency', 'km_per_l', { ...CIVIC_FIELDS, modelYear: 1950 })).toEqual(
      PLAUSIBLE_BANDS.km_per_l
    );
    expect(bandFor('efficiency', 'km_per_l', { ...CIVIC_FIELDS, vehicleType: 'hybrid' })).toEqual(
      PLAUSIBLE_BANDS.km_per_l
    );
    expect(bandFor('running_cost', 'cents_per_km', { ...CIVIC_FIELDS, currency: 'USD' })).toEqual(
      MONEY_BANDS_USD_CENTS.running_cost
    );
  });

  test('money ranges are set in US cents and scaled to each currency and its minor unit', () => {
    expect(moneyBand('running_cost', 'EUR')).toEqual({ lo: 0.92, hi: 27.6, step: 0.1 });
    expect(moneyBand('running_cost', 'INR')).toEqual({ lo: 84, hi: 2520, step: 10 });
    expect(moneyBand('maintenance', 'JPY')).toEqual({ lo: 0, hi: 360_000, step: 1000 });
    expect(moneyBand('insurance', 'VND')).toEqual({
      lo: 7_500_000,
      hi: 150_000_000,
      step: 100_000,
    });
    expect(moneyBand('running_cost', 'ARS')).toBeNull();
    expect(moneyBand('running_cost', null)).toBeNull();
  });

  test('a typical running cost in rupees is counted, and a currency with no range publishes nothing', () => {
    const rupees = owners(10).map((id) =>
      vehicle(id, { currency: 'INR', expenses: fillUps({ cents: 400_000 }) })
    );
    const running = aggregate(rupees, OPTIONS).rows.find((row) => row.metric === 'running_cost');
    expect(running?.nPublished).toBe(10);
    expect(running?.currency).toBe('INR');

    const pesos = owners(10).map((id) => vehicle(id, { currency: 'ARS' }));
    expect(aggregate(pesos, OPTIONS).rows.filter((row) => row.metric !== 'efficiency')).toEqual([]);
  });

  test('a value outside the rated band is dropped, but counts for an unrated model', () => {
    const outlier = (catalogModelId: string) =>
      vehicle('outlier', { catalogModelId, expenses: fillUps({ volume: 5 }) });
    const typical = (catalogModelId: string) =>
      owners(14).map((id) => vehicle(id, { catalogModelId }));
    expect(efficiencyRow([...typical('honda-civic'), outlier('honda-civic')])?.nPublished).toBe(10);
    expect(efficiencyRow([...typical('audi-a1'), outlier('audi-a1')])?.nPublished).toBe(15);
  });

  test("the mean's noise scale is the band width over ε_sum times the count", () => {
    expect(noiseScaleFor({ lo: 2, hi: 60 }, 10)).toBeCloseTo(11.6, 9);
    expect(noiseScaleFor({ lo: 2, hi: 60 }, 100)).toBeCloseTo(1.16, 9);
  });

  test('a group publishes only once its noisy count reaches the threshold', () => {
    const fourteen = owners(14).map((id) => vehicle(id));
    expect(efficiencyRow(fourteen, { ...OPTIONS, minGroup: 15 })).toBeUndefined();
    const fifteen = owners(15).map((id) => vehicle(id));
    expect(efficiencyRow(fifteen, { ...OPTIONS, minGroup: 15 })?.nPublished).toBe(15);
  });

  test('unchanged data under the same key gives the same release, so refreshes cannot be averaged', () => {
    const group = () => owners(40).map((id) => vehicle(id));
    const keyed = { now: NOW, minGroup: 30, noiseKey: 'test-key' };
    const first = aggregate(group(), keyed).rows;
    expect(first.length).toBeGreaterThan(0);
    expect(aggregate(group(), keyed).rows).toEqual(first);
    expect(
      aggregate(group(), { ...keyed, now: new Date(NOW.getTime() + DAY) }).rows.map((r) => r.mean)
    ).toEqual(first.map((r) => r.mean));
  });

  test('a schema version bump keeps the noise already published for unchanged data', () => {
    const keyed = { now: NOW, minGroup: 30, noiseKey: 'test-key' };
    const row = aggregate(
      owners(40).map((id) => vehicle(id)),
      keyed
    ).rows.find((r) => r.metric === 'efficiency');
    expect(row?.schemaVersion).toBe(COMMUNITY_SCHEMA_VERSION);
    expect({ n: row?.nPublished, mean: row?.mean }).toEqual(PUBLISHED_UNDER_VERSION_1);
  });

  test('a change to the data, or a different key, draws fresh noise', () => {
    const labels = (vehicles: CommunityVehicle[]) => {
      const seen: string[] = [];
      aggregate(vehicles, {
        ...OPTIONS,
        uniform: (label) => {
          seen.push(label);
          return 0.5;
        },
      });
      return seen;
    };
    const forty = owners(40).map((id) => vehicle(id));
    const joined = [...forty, vehicle('newcomer')];
    const changed = [
      ...forty.slice(1),
      vehicle(forty[0]?.ownerId ?? '', { expenses: fillUps({ volume: 9 }) }),
    ];
    const before = labels(forty);
    const efficiencyLabels = (list: string[]) => list.filter((l) => l.startsWith('efficiency|'));
    expect(labels(joined).filter((label) => before.includes(label))).toEqual([]);
    expect(efficiencyLabels(before)).toHaveLength(2);
    expect(efficiencyLabels(labels(changed)).filter((label) => before.includes(label))).toEqual([]);
    expect(labels(changed).filter((label) => before.includes(label)).length).toBeGreaterThan(0);

    const [label = ''] = before;
    expect(keyedUniform('a')(label)).toBe(keyedUniform('a')(label));
    expect(keyedUniform('a')(label)).not.toBe(keyedUniform('b')(label));
    for (const probe of ['x', 'y', 'z']) {
      const u = keyedUniform('a')(probe);
      expect(u).toBeGreaterThan(0);
      expect(u).toBeLessThan(1);
    }
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

  test('an efficiency outside the plausibility band is dropped before counting', () => {
    const odd = owners(10).map((id) =>
      vehicle(id, { catalogModelId: 'audi-a1', expenses: fillUps({ volume: 0.5 }) })
    );
    expect(efficiencyRow(odd)).toBeUndefined();
  });

  test('a money value outside its range still counts, clamped to the range edge', () => {
    const pricey = owners(10).map((id) =>
      vehicle(id, {
        expenses: fillUps({}).map((expense, index) =>
          index === 0 ? { ...expense, category: 'maintenance', expenseAmount: 3_000_000 } : expense
        ),
      })
    );
    const maintenance = aggregate(pricey, OPTIONS).rows.find((row) => row.metric === 'maintenance');
    expect(maintenance?.nPublished).toBe(10);
    expect(maintenance?.mean).toBe(MONEY_BANDS_USD_CENTS.maintenance.hi);
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
    expect(running?.value).toBeCloseTo((5 * 4000) / (5 * 300 * 1.609344), 6);
    expect(running?.bucketKey).toBe('running_cost|gas|car|USD|-');
  });

  test('running cost is the same per km however often a vehicle fills up', () => {
    const costPerKm = (count: number) =>
      vehicleSamples(
        vehicle('v', { expenses: fillUps({ count, distance: 500 / 1.609344 }) }),
        NOW
      ).find((s) => s.metric === 'running_cost')?.value;
    for (const count of [3, 4, 13]) expect(costPerKm(count)).toBeCloseTo(4000 / 500, 6);
  });

  test('a fill-up after an earlier odometer reading still counts toward running cost', () => {
    const miles = 500 / 1.609344;
    const fills = fillUps({ count: 3, distance: miles, startMileage: 1000 + miles });
    const withEarlierReading = vehicle('v', { expenses: fills, odometerReadings: [1000] });
    const running = vehicleSamples(withEarlierReading, NOW).find(
      (s) => s.metric === 'running_cost'
    );
    expect(running?.value).toBeCloseTo((3 * 4000) / 1500, 6);

    const oneFill = vehicle('one', {
      expenses: fillUps({ count: 1, startMileage: 1000 + 2 * miles }),
      odometerReadings: [1000],
    });
    const single = vehicleSamples(oneFill, NOW).find((s) => s.metric === 'running_cost');
    expect(single?.value).toBeCloseTo(4000 / 1000, 6);
  });

  test('a motorcycle and a car with the same powertrain never share a cost or maintenance group', () => {
    const keys = (vehicleKind: string) =>
      vehicleSamples(vehicle(vehicleKind, { vehicleKind }), NOW)
        .filter((s) => s.metric === 'running_cost' || s.metric === 'maintenance')
        .map((s) => s.bucketKey);
    const car = keys('car');
    const motorcycle = keys('motorcycle');
    expect(car).toHaveLength(2);
    expect(motorcycle).toHaveLength(2);
    expect(motorcycle.filter((key) => car.includes(key))).toEqual([]);

    const riders = owners(10).map((id) => vehicle(id, { vehicleKind: 'motorcycle' }));
    const drivers = owners(10, 'driver').map((id) => vehicle(id));
    const rows = aggregate([...riders, ...drivers], OPTIONS).rows.filter(
      (row) => row.metric === 'running_cost'
    );
    expect(rows.map((row) => [row.bucketKey, row.nPublished]).sort()).toEqual([
      ['running_cost|gas|car|USD|-', 10],
      ['running_cost|gas|motorcycle|USD|-', 10],
    ]);
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
