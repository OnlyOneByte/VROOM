import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { ON_POSTGRES } from '../../../test-helpers/http-client';
import type { SQL } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core';
import { applyMigrationsUpTo, loadMigrations } from '../../../db/__tests__/migration-helpers';
import { openAsyncDatabase } from '../../../db/async-sqlite';
import * as schema from '../../../db/schema';
import { EXPENSE_CATEGORIES } from '../../../db/types';
import { ValidationError } from '../../../errors';
import { MAX_SERVICES } from '../annotations';
import { analyticsQueryToApi } from '../api-transform';
import {
  type AnalyticsQuery,
  AnalyticsQueryRepository,
  type BucketItemsQuery,
  buildBuckets,
  compareBuckets,
  MAX_QUERY_BUCKETS,
} from '../query-repository';
import { AnalyticsRepository } from '../repository';
import {
  seedExpense,
  seedUser,
  seedVehicle,
  openAnalyticsTestDb,
  type AnalyticsTestDb,
} from './analytics-test-db';

const seconds = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);
const OWNER = { id: 'owner', email: 'owner@test.com', displayName: 'Owner' };
const STRANGER = { id: 'stranger', email: 'stranger@test.com', displayName: 'Stranger' };
const CAMRY = { id: 'camry', userId: OWNER.id, make: 'Toyota', model: 'Camry', year: 2020 };
const LEAF = { id: 'leaf', userId: OWNER.id, make: 'Nissan', model: 'Leaf', year: 2022 };
const OTHER = { id: 'other-car', userId: STRANGER.id, make: 'Ford', model: 'F-150', year: 2019 };
const RANGE = { start: seconds('2024-01-01T00:00:00Z'), end: seconds('2025-07-01T00:00:00Z') };

let testDb: AnalyticsTestDb;
let repo: AnalyticsQueryRepository;

function baseQuery(overrides: Partial<AnalyticsQuery> = {}): AnalyticsQuery {
  return {
    metric: 'cost',
    interval: 'month',
    groupBy: 'none',
    include: 'all',
    compare: 'none',
    energy: 'fuel',
    start: RANGE.start,
    end: RANGE.end,
    ...overrides,
  };
}

async function setUnits(table: 'vehicles' | 'user_preferences', id: string, units: object): Promise<void> {
  const json = JSON.stringify({ chargeUnit: 'kwh', ...units });
  if (table === 'vehicles') {
    await testDb.sql.run('UPDATE vehicles SET unit_preferences = ? WHERE id = ?', [json, id]);
    return;
  }
  await testDb.sql.run(
    'INSERT INTO user_preferences (user_id, unit_preferences) VALUES (?, ?) ON CONFLICT (user_id) DO UPDATE SET unit_preferences = excluded.unit_preferences',
    [id, json]
  );
}

async function seedFleet(): Promise<void> {
  const categories = EXPENSE_CATEGORIES;
  let mileage = 10_000;
  let leafMileage = 5_000;
  for (let i = 0; i < 18 * 4; i++) {
    const date = new Date(Date.UTC(2024, 0, 3) + i * 7.5 * 86_400_000);
    mileage += 300;
    await seedExpense(testDb.sql, {
      id: `gas-${i}`,
      vehicleId: CAMRY.id,
      category: 'fuel',
      expenseAmount: 4_000 + i * 10,
      date,
      mileage,
      volume: 10,
      fuelType: i % 3 === 0 ? 'Premium' : 'Regular',
      missedFillup: i === 5,
    });
    leafMileage += 120;
    await seedExpense(testDb.sql, {
      id: `charge-${i}`,
      vehicleId: LEAF.id,
      category: 'fuel',
      expenseAmount: 900,
      date: new Date(date.getTime() + 3_600_000),
      mileage: leafMileage,
      volume: 30,
      fuelType: 'Level 2 (AC)',
      missedFillup: false,
    });
    const category = categories[i % categories.length] ?? 'misc';
    await seedExpense(testDb.sql, {
      id: `other-${i}`,
      vehicleId: i % 2 === 0 ? CAMRY.id : LEAF.id,
      category,
      expenseAmount: 12_345 + i * 100,
      date: new Date(date.getTime() + 2 * 86_400_000),
      mileage: null,
      volume: null,
      fuelType: null,
      missedFillup: false,
    });
  }
  await testDb.sql.run(`UPDATE expenses SET tags = '["work","road trip"]' WHERE id = 'other-0'`);
  await testDb.sql.run(`UPDATE expenses SET tags = '["work"]' WHERE id = 'other-1'`);
}

beforeEach(async () => {
  testDb = await openAnalyticsTestDb();
  repo = new AnalyticsQueryRepository(testDb.asyncDb);
  await seedUser(testDb.sql, OWNER);
  await seedUser(testDb.sql, STRANGER);
  await seedVehicle(testDb.sql, CAMRY);
  await seedVehicle(testDb.sql, LEAF);
  await seedVehicle(testDb.sql, OTHER);
});

afterEach(() => testDb.close());

describe('GET /analytics/query matches the existing summary aggregations', () => {
  test('monthly totals and category splits equal the Cross-Vehicle and heatmap numbers', async () => {
    await seedFleet();
    const legacy = new AnalyticsRepository(testDb.asyncDb);
    const cross = await legacy.getCrossVehicle(OWNER.id, RANGE);
    const advanced = await legacy.getFuelAdvanced(OWNER.id, RANGE);

    const monthly = await repo.query(OWNER.id, baseQuery());
    const total = monthly.series[0];
    expect(total?.key).toBe('total');
    const nonEmpty = monthly.buckets
      .map((month, i) => ({ month, amount: total?.values[i] ?? 0 }))
      .filter((m) => m.amount !== 0);
    expect(nonEmpty).toEqual(cross.monthlyExpenseTrends);

    const split = await repo.query(OWNER.id, baseQuery({ groupBy: 'category' }));
    for (const row of advanced.monthlyCostHeatmap) {
      const idx = split.buckets.indexOf(row.month);
      for (const category of EXPENSE_CATEGORIES) {
        const series = split.series.find((s) => s.key === category);
        expect(series?.values[idx] ?? 0).toBe(row[category]);
      }
    }

    const byCategory = await repo.query(
      OWNER.id,
      baseQuery({ interval: 'none', groupBy: 'category' })
    );
    for (const row of cross.expenseByCategory) {
      expect(byCategory.series.find((s) => s.key === row.category)?.values[0]).toBe(row.amount);
    }
  });

  test('cost per distance and pooled efficiency equal the quick stats', async () => {
    await seedFleet();
    const legacy = new AnalyticsRepository(testDb.asyncDb);
    const summary = await legacy.getSummary(OWNER.id, RANGE);

    const perDistance = await repo.query(
      OWNER.id,
      baseQuery({ metric: 'costPerDistance', interval: 'none' })
    );
    expect(perDistance.totals.value).toBeCloseTo(summary.quickStats.costPerDistance ?? -1, 9);
    expect(perDistance.totals.perDistance).toBeCloseTo(summary.quickStats.costPerDistance ?? -1, 9);

    const efficiency = await repo.query(
      OWNER.id,
      baseQuery({ metric: 'efficiency', interval: 'none' })
    );
    expect(efficiency.totals.value).toBeCloseTo(summary.quickStats.avgEfficiency ?? -1, 9);
    expect(efficiency.unit).toBe('miles/gallons_us');
  });

  test('running costs are every category except financial, as on the Dashboard', async () => {
    await seedFleet();
    const running = await repo.query(
      OWNER.id,
      baseQuery({ include: 'running', interval: 'none', groupBy: 'category' })
    );
    expect(running.series.map((s) => s.key).sort()).toEqual([
      'enhancement',
      'fuel',
      'maintenance',
      'misc',
      'regulatory',
    ]);
    const picked = await repo.query(
      OWNER.id,
      baseQuery({ interval: 'none', groupBy: 'category', categories: ['maintenance', 'financial'] })
    );
    expect(picked.series.map((s) => s.key).sort()).toEqual(['financial', 'maintenance']);
  });
});

describe('a start before any data', () => {
  test('begins at the first expense, so All time draws no empty years', async () => {
    await seedFleet();
    const result = await repo.query(OWNER.id, baseQuery({ start: 1 }));
    expect(result.buckets[0]).toBe('2024-01');
    expect(result.range.start).toBeGreaterThanOrEqual(RANGE.start);
    const later = await repo.query(OWNER.id, baseQuery({ start: seconds('2024-06-01T00:00:00Z') }));
    expect(later.buckets[0]).toBe('2024-06');
  });

  test('a range that ends before the first expense keeps the range that was asked for', async () => {
    await seedFleet();
    const range = { start: seconds('2023-01-01T00:00:00Z'), end: seconds('2023-04-01T00:00:00Z') };
    const result = await repo.query(OWNER.id, baseQuery(range));
    expect(result.buckets).toEqual(['2023-01', '2023-02', '2023-03']);
    expect(result.range).toEqual(range);
    expect(result.series).toEqual([]);
  });

  test('All time with no expenses falls back to the year before the end', async () => {
    for (const interval of ['month', 'week'] as const) {
      const result = await repo.query(OWNER.id, baseQuery({ interval, start: 1 }));
      expect(result.range).toEqual({ start: RANGE.end - 365 * 86_400, end: RANGE.end });
      expect(result.buckets.length).toBeLessThanOrEqual(interval === 'month' ? 13 : 54);
      expect(result.series).toEqual([]);
    }
  });

  test('All time when every expense is after the end falls back to the year before the end', async () => {
    await seedFleet();
    const end = seconds('2023-06-01T00:00:00Z');
    const result = await repo.query(OWNER.id, baseQuery({ interval: 'week', start: 1, end }));
    expect(result.range).toEqual({ start: end - 365 * 86_400, end });
    expect(result.series).toEqual([]);
  });
});

describe('bucketing follows the user calendar', () => {
  const lateOnJan31 = [
    { zone: 'America/Los_Angeles', instant: '2025-02-01T07:30:00Z' },
    { zone: 'Asia/Tokyo', instant: '2025-01-31T14:30:00Z' },
  ];

  for (const { zone, instant } of lateOnJan31) {
    test(`23:30 on Jan 31 in ${zone} lands in January`, async () => {
      await seedExpense(testDb.sql, {
        id: `late-${zone}`,
        vehicleId: CAMRY.id,
        category: 'maintenance',
        expenseAmount: 5_000,
        date: new Date(instant),
        mileage: null,
        volume: null,
        fuelType: null,
        missedFillup: false,
      });
      const result = await repo.query(
        OWNER.id,
        baseQuery({
          start: seconds('2024-12-01T00:00:00Z'),
          end: seconds('2025-04-01T00:00:00Z'),
          timeZone: zone,
        })
      );
      const january = result.buckets.indexOf('2025-01');
      expect(result.series[0]?.values[january]).toBe(5_000);
      expect(result.series[0]?.values[january + 1]).toBe(0);
    });
  }

  test('week, quarter and year buckets start on local Monday, quarter and year boundaries', () => {
    const zone = 'America/New_York';
    const range = { start: seconds('2025-03-05T12:00:00Z'), end: seconds('2025-03-20T00:00:00Z') };
    const weeks = buildBuckets(range, 'week', zone);
    expect(weeks.map((w) => w.key)).toEqual(['2025-03-03', '2025-03-10', '2025-03-17']);
    expect(weeks[0]?.start).toBe(range.start);
    expect(weeks[1]?.start).toBe(seconds('2025-03-10T04:00:00Z'));
    expect(weeks.at(-1)?.end).toBe(range.end);

    const year = { start: seconds('2024-02-10T00:00:00Z'), end: seconds('2025-05-01T00:00:00Z') };
    expect(buildBuckets(year, 'quarter', 'UTC').map((q) => q.key)).toEqual([
      '2024-Q1',
      '2024-Q2',
      '2024-Q3',
      '2024-Q4',
      '2025-Q1',
      '2025-Q2',
    ]);
    expect(buildBuckets(year, 'year', 'UTC').map((y) => y.key)).toEqual(['2024', '2025']);
    expect(buildBuckets(year, 'none', 'UTC')).toEqual([{ key: 'total', ...year }]);
  });

  test('a range with too many buckets is refused', () => {
    const range = { start: seconds('1990-01-01T00:00:00Z'), end: seconds('2025-01-01T00:00:00Z') };
    expect(() => buildBuckets(range, 'week', 'UTC')).toThrow(ValidationError);
    expect(MAX_QUERY_BUCKETS).toBeGreaterThan(24 * 4);
  });

  test('the year before lines up month by month across a leap day and a clock change', () => {
    const zone = 'America/Los_Angeles';
    const spring = buildBuckets(
      { start: seconds('2024-02-01T08:00:00Z'), end: seconds('2024-04-01T07:00:00Z') },
      'month',
      zone
    );
    expect(spring.map((b) => b.key)).toEqual(['2024-02', '2024-03']);
    const [feb, mar] = spring;
    expect(((feb?.end ?? 0) - (feb?.start ?? 0)) / 86_400).toBe(29);
    expect(((mar?.end ?? 0) - (mar?.start ?? 0)) / 3_600).toBe(31 * 24 - 1);

    const before = compareBuckets(spring, 'month', 'prevYear', zone);
    expect(before?.map((b) => b.key)).toEqual(['2023-02', '2023-03']);
    expect(before?.[0]).toMatchObject({
      start: seconds('2023-02-01T08:00:00Z'),
      end: seconds('2023-03-01T08:00:00Z'),
    });
    expect(before?.[1]?.end).toBe(seconds('2023-04-01T07:00:00Z'));
  });

  test('compare buckets shift each bucket back one period or one local year', () => {
    const march = buildBuckets(
      { start: seconds('2025-03-01T00:00:00Z'), end: seconds('2025-04-01T00:00:00Z') },
      'month',
      'UTC'
    );
    expect(compareBuckets(march, 'month', 'none', 'UTC')).toBeNull();
    expect(compareBuckets(march, 'month', 'prevPeriod', 'UTC')).toEqual([
      {
        key: '2025-02',
        start: seconds('2025-02-01T00:00:00Z'),
        end: seconds('2025-03-01T00:00:00Z'),
      },
    ]);
    const year = buildBuckets(
      { start: seconds('2024-03-15T00:00:00Z'), end: seconds('2024-06-01T00:00:00Z') },
      'month',
      'UTC'
    );
    const prevYear = compareBuckets(year, 'month', 'prevYear', 'UTC');
    expect(prevYear?.map((b) => b.key)).toEqual(['2023-03', '2023-04', '2023-05']);
    expect(prevYear?.[0]?.start).toBe(seconds('2023-03-15T00:00:00Z'));
    const prevQuarter = compareBuckets(year, 'month', 'prevPeriod', 'UTC');
    expect(prevQuarter?.map((b) => b.key)).toEqual(['2023-12', '2024-01', '2024-02']);
    expect(prevQuarter?.[0]?.start).toBe(seconds('2023-12-15T00:00:00Z'));

    const weeks = buildBuckets(
      { start: seconds('2025-03-03T00:00:00Z'), end: seconds('2025-03-17T00:00:00Z') },
      'week',
      'UTC'
    );
    expect(compareBuckets(weeks, 'week', 'prevPeriod', 'UTC')?.map((b) => b.key)).toEqual([
      '2025-02-17',
      '2025-02-24',
    ]);
    expect(compareBuckets(weeks, 'week', 'prevYear', 'UTC')?.map((b) => b.key)).toEqual([
      '2024-03-04',
      '2024-03-11',
    ]);

    const total = buildBuckets(
      { start: seconds('2024-02-29T00:00:00Z'), end: seconds('2024-03-29T00:00:00Z') },
      'none',
      'UTC'
    );
    expect(compareBuckets(total, 'none', 'prevYear', 'UTC')?.[0]?.start).toBe(
      seconds('2023-02-28T00:00:00Z')
    );
    expect(compareBuckets(total, 'none', 'prevPeriod', 'UTC')).toEqual([
      {
        key: 'total',
        start: seconds('2024-01-31T00:00:00Z'),
        end: seconds('2024-02-29T00:00:00Z'),
      },
    ]);
    expect(compareBuckets([], 'month', 'prevYear', 'UTC')).toBeNull();
  });

  test('a previous-period comparison holds exactly the matching months', async () => {
    for (const [id, iso, amount] of [
      ['jan', '2025-01-30T12:00:00Z', 100],
      ['feb', '2025-02-10T12:00:00Z', 7_000],
      ['mar', '2025-03-10T12:00:00Z', 500],
    ] as const) {
      await seedExpense(testDb.sql, {
        id,
        vehicleId: CAMRY.id,
        category: 'maintenance',
        expenseAmount: amount,
        date: new Date(iso),
        mileage: null,
        volume: null,
        fuelType: null,
        missedFillup: false,
      });
    }
    const result = await repo.query(
      OWNER.id,
      baseQuery({
        start: seconds('2025-03-01T00:00:00Z'),
        end: seconds('2025-04-01T00:00:00Z'),
        compare: 'prevPeriod',
      })
    );
    expect(result.compare?.buckets).toEqual(['2025-02']);
    expect(result.compare?.series[0]?.values).toEqual([7_000]);
    expect(result.compare?.totals.value).toBe(7_000);
    expect(result.compare?.totals.perBucket).toBe(7_000);
  });
});

describe('same-day fill-ups pair by odometer', () => {
  const fill = async (id: string, iso: string, mileage: number) =>
    await seedExpense(testDb.sql, {
      id,
      vehicleId: CAMRY.id,
      category: 'fuel',
      expenseAmount: 4_000,
      date: new Date(iso),
      mileage,
      volume: 10,
      fuelType: 'Regular',
      missedFillup: false,
    });

  const orders = [
    {
      name: 'the lower reading saved first, with the smaller id',
      first: ['a-fill', 10_300],
      second: ['z-fill', 10_600],
    },
    {
      name: 'the higher reading saved first, with the smaller id',
      first: ['a-fill', 10_600],
      second: ['z-fill', 10_300],
    },
  ] as const;

  for (const { name, first, second } of orders) {
    test(`economy and distance are right with ${name}`, async () => {
      await fill('start', '2025-03-01T12:00:00Z', 10_000);
      await fill(first[0], '2025-03-10T12:00:00Z', first[1]);
      await fill(second[0], '2025-03-10T12:00:00Z', second[1]);
      await fill('end', '2025-03-20T12:00:00Z', 10_900);

      const distance = await repo.query(
        OWNER.id,
        baseQuery({ metric: 'distance', interval: 'month' })
      );
      expect(distance.series[0]?.values[distance.buckets.indexOf('2025-03')]).toBe(900);
      const efficiency = await repo.query(
        OWNER.id,
        baseQuery({ metric: 'efficiency', interval: 'month' })
      );
      expect(efficiency.totals.value).toBeCloseTo(30, 9);

      const summary = await new AnalyticsRepository(
        testDb.asyncDb
      ).getSummary(OWNER.id, RANGE);
      expect(summary.quickStats.avgEfficiency).toBeCloseTo(30, 9);
    });
  }

  test('the reading before the range is the highest one on its date', async () => {
    await fill('a-prev', '2025-02-20T12:00:00Z', 10_600);
    await fill('z-prev', '2025-02-20T12:00:00Z', 10_300);
    await fill('inside', '2025-03-10T12:00:00Z', 10_900);
    const distance = await repo.query(
      OWNER.id,
      baseQuery({ metric: 'distance', interval: 'month', start: seconds('2025-03-01T00:00:00Z') })
    );
    expect(distance.series[0]?.values[distance.buckets.indexOf('2025-03')]).toBe(300);
  });
});

describe('annotations', () => {
  const monthOf = (t: number) => new Date(t * 1000).toISOString().slice(0, 7);

  test('a service marker in every month with maintenance, and none elsewhere', async () => {
    await seedFleet();
    const byCategory = await repo.query(OWNER.id, baseQuery({ groupBy: 'category' }));
    const maintenance = byCategory.series.find((s) => s.key === 'maintenance');
    const months = byCategory.buckets.filter((_, i) => (maintenance?.values[i] ?? 0) > 0);
    const result = await repo.query(OWNER.id, baseQuery({ annotations: ['services'] }));
    expect(months.length).toBeGreaterThan(0);
    expect([...new Set(result.annotations?.map((a) => monthOf(a.t)))]).toEqual(months);
    const first = result.annotations?.[0];
    expect(first?.kind).toBe('service');
    expect(first?.vehicleName).toMatch(/Toyota Camry|Nissan Leaf/);
    expect(first?.amount).toBeGreaterThan(0);
    expect(result.trips).toBeUndefined();
  });

  test('follow the car and range filters and never show another user', async () => {
    await seedFleet();
    await seedExpense(testDb.sql, {
      id: 'stranger-service',
      vehicleId: OTHER.id,
      category: 'maintenance',
      expenseAmount: 9_999,
      date: new Date('2024-05-05T12:00:00Z'),
      mileage: null,
      volume: null,
      fuelType: null,
      missedFillup: false,
    });
    const leaf = await repo.query(
      OWNER.id,
      baseQuery({
        annotations: ['services'],
        vehicleIds: [LEAF.id],
        start: seconds('2024-03-01T00:00:00Z'),
        end: seconds('2024-09-01T00:00:00Z'),
      })
    );
    expect(leaf.annotations?.length).toBeGreaterThan(0);
    for (const a of leaf.annotations ?? []) {
      expect(a.vehicleId).toBe(LEAF.id);
      expect(a.t).toBeGreaterThanOrEqual(seconds('2024-03-01T00:00:00Z'));
      expect(a.t).toBeLessThan(seconds('2024-09-01T00:00:00Z'));
    }
    const forced = await repo.query(
      OWNER.id,
      baseQuery({ annotations: ['services', 'trips'], vehicleIds: [OTHER.id] })
    );
    expect(forced.annotations ?? []).toEqual([]);
  });

  test('past the cap, the newest services are kept and the result says so', async () => {
    const start = seconds('2024-01-01T00:00:00Z');
    for (let i = 0; i <= MAX_SERVICES; i++) {
      await testDb.sql.run(
        "INSERT INTO expenses (id, vehicle_id, user_id, category, expense_amount, date, missed_fillup) VALUES (?, ?, ?, 'maintenance', 100, ?, FALSE)",
        [`many-${i}`, CAMRY.id, OWNER.id, start + i * 3_600]
      );
    }
    const result = await repo.query(OWNER.id, baseQuery({ annotations: ['services'] }));
    expect(result.annotations).toHaveLength(MAX_SERVICES);
    expect(result.annotationsTruncated).toBe(true);
    expect(result.annotations?.at(-1)?.t).toBe(start + MAX_SERVICES * 3_600);
    expect(result.annotations?.[0]?.t).toBe(start + 3_600);
  });

  test('trips count and distance per bucket, in the user units', async () => {
    await setUnits('vehicles', CAMRY.id, { distanceUnit: 'kilometers', volumeUnit: 'liters' });
    for (const [i, day] of ['2024-02-03', '2024-02-20', '2024-04-10'].entries()) {
      await testDb.sql.run(
        'INSERT INTO trips (id, vehicle_id, user_id, start_odometer, end_odometer, purpose, trip_date) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [`trip-${i}`, CAMRY.id, OWNER.id, 1_000, 1_100, 'personal', seconds(`${day}T12:00:00Z`)]
      );
    }
    const result = await repo.query(
      OWNER.id,
      baseQuery({
        annotations: ['trips'],
        start: seconds('2024-01-01T00:00:00Z'),
        end: seconds('2024-07-01T00:00:00Z'),
      })
    );
    const at = (key: string) => result.buckets.indexOf(key);
    expect(result.trips?.count[at('2024-02')]).toBe(2);
    expect(result.trips?.count[at('2024-04')]).toBe(1);
    expect(result.trips?.count[at('2024-03')]).toBe(0);
    expect(result.trips?.distance[at('2024-02')]).toBeCloseTo(124.27, 1);
    expect(result.trips?.count).toHaveLength(result.buckets.length);
  });
});

describe('units', () => {
  async function seedTwoFillups(vehicleId: string, startMileage: number, volume: number): Promise<void> {
    for (const [i, offset] of [0, 400].entries()) {
      await seedExpense(testDb.sql, {
        id: `${vehicleId}-fill-${i}`,
        vehicleId,
        category: 'fuel',
        expenseAmount: 5_000,
        date: new Date(Date.UTC(2024, 5, 1 + i * 10)),
        mileage: startMileage + offset,
        volume,
        fuelType: 'Regular',
        missedFillup: false,
      });
    }
  }

  test('a metric fleet gets kilometres and litres back unchanged', async () => {
    const metric = { distanceUnit: 'kilometers', volumeUnit: 'liters' };
    await setUnits('user_preferences', OWNER.id, metric);
    await setUnits('vehicles', CAMRY.id, metric);
    await setUnits('vehicles', LEAF.id, metric);
    await seedTwoFillups(CAMRY.id, 1_000, 30);

    const distance = await repo.query(
      OWNER.id,
      baseQuery({ metric: 'distance', interval: 'none' })
    );
    expect(distance.unit).toBe('kilometers');
    expect(distance.totals.value).toBe(400);
    const volume = await repo.query(OWNER.id, baseQuery({ metric: 'volume', interval: 'none' }));
    expect(volume.unit).toBe('liters');
    expect(volume.totals.value).toBe(60);
  });

  test('a mixed fleet converts each vehicle to the user units', async () => {
    await setUnits('user_preferences', OWNER.id, { distanceUnit: 'miles', volumeUnit: 'gallons_us' });
    await setUnits('vehicles', CAMRY.id, { distanceUnit: 'kilometers', volumeUnit: 'liters' });
    await setUnits('vehicles', LEAF.id, { distanceUnit: 'miles', volumeUnit: 'gallons_us' });
    await seedTwoFillups(CAMRY.id, 1_000, 37.854_117_84);
    await seedTwoFillups(LEAF.id, 2_000, 10);

    const distance = await repo.query(
      OWNER.id,
      baseQuery({ metric: 'distance', interval: 'none', groupBy: 'vehicle' })
    );
    const byKey = Object.fromEntries(distance.series.map((s) => [s.key, s.values[0]]));
    expect(byKey[CAMRY.id]).toBeCloseTo(400 / 1.609344, 6);
    expect(byKey[LEAF.id]).toBe(400);
    expect(distance.totals.distance).toBeCloseTo(400 + 400 / 1.609344, 6);

    const volume = await repo.query(
      OWNER.id,
      baseQuery({ metric: 'volume', interval: 'none', groupBy: 'vehicle' })
    );
    const volumes = Object.fromEntries(volume.series.map((s) => [s.key, s.values[0]]));
    expect(volumes[CAMRY.id]).toBeCloseTo(20, 6);
    expect(volumes[LEAF.id]).toBe(20);
  });

  test('electric energy and efficiency are measured apart from liquid fuel', async () => {
    await seedFleet();
    const energy = await repo.query(
      OWNER.id,
      baseQuery({ metric: 'volume', energy: 'electric', interval: 'none' })
    );
    expect(energy.unit).toBe('kwh');
    expect(energy.totals.value).toBe(72 * 30);
    const efficiency = await repo.query(
      OWNER.id,
      baseQuery({ metric: 'efficiency', energy: 'electric', interval: 'none' })
    );
    expect(efficiency.unit).toBe('miles/kwh');
    expect(efficiency.totals.value).toBeCloseTo(4, 9);
  });
});

describe('access', () => {
  test("another user's vehicles are never aggregated", async () => {
    await seedFleet();
    await seedExpense(testDb.sql, {
      id: 'foreign',
      vehicleId: OTHER.id,
      category: 'maintenance',
      expenseAmount: 999_999,
      date: new Date('2024-06-01T00:00:00Z'),
      mileage: null,
      volume: null,
      fuelType: null,
      missedFillup: false,
    });
    const mine = await repo.query(OWNER.id, baseQuery({ interval: 'none' }));
    const mixed = await repo.query(
      OWNER.id,
      baseQuery({ interval: 'none', vehicleIds: [CAMRY.id, LEAF.id, OTHER.id] })
    );
    expect(mixed.totals.value).toBe(mine.totals.value);

    const onlyForeign = await repo.query(
      OWNER.id,
      baseQuery({ interval: 'none', groupBy: 'vehicle', vehicleIds: [OTHER.id] })
    );
    expect(onlyForeign.series).toEqual([]);
    expect(onlyForeign.totals.value).toBe(0);

    const stranger = await repo.query(
      STRANGER.id,
      baseQuery({ interval: 'none', vehicleIds: [CAMRY.id] })
    );
    expect(stranger.totals.value).toBe(0);
  });
});

describe('splits, compare and shape', () => {
  test('vehicle and fuel type splits label their series', async () => {
    await seedFleet();
    const byVehicle = await repo.query(
      OWNER.id,
      baseQuery({ interval: 'none', groupBy: 'vehicle' })
    );
    expect(byVehicle.series.map((s) => s.label).sort()).toEqual([
      '2020 Toyota Camry',
      '2022 Nissan Leaf',
    ]);
    const byFuel = await repo.query(OWNER.id, baseQuery({ interval: 'none', groupBy: 'fuelType' }));
    expect(byFuel.series.map((s) => s.key).sort()).toEqual([
      '',
      'Level 2 (AC)',
      'Premium',
      'Regular',
    ]);
    const camry = await repo.query(
      OWNER.id,
      baseQuery({ interval: 'none', vehicleIds: [CAMRY.id] })
    );
    const leaf = await repo.query(OWNER.id, baseQuery({ interval: 'none', vehicleIds: [LEAF.id] }));
    const all = await repo.query(OWNER.id, baseQuery({ interval: 'none' }));
    expect((camry.totals.value ?? 0) + (leaf.totals.value ?? 0)).toBe(all.totals.value ?? -1);
  });

  test('a tag split counts an expense under each tag but once in the totals', async () => {
    await seedFleet();
    const tags = await repo.query(
      OWNER.id,
      baseQuery({ interval: 'none', groupBy: 'tag', categories: ['regulatory'] })
    );
    expect(tags.series.map((s) => s.label)).toEqual(['Untagged']);
    const tagged = await repo.query(OWNER.id, baseQuery({ interval: 'none', groupBy: 'tag' }));
    const value = (key: string) => tagged.series.find((s) => s.key === key)?.values[0];
    expect(value('work')).toBe(12_345 + 12_445);
    expect(value('road trip')).toBe(12_345);
    const plain = await repo.query(OWNER.id, baseQuery({ interval: 'none' }));
    expect(tagged.totals.value).toBe(plain.totals.value);
  });

  test('the first bucket counts the distance from the reading before the range', async () => {
    for (const [i, iso, mileage] of [
      [0, '2025-01-10T12:00:00Z', 1_000],
      [1, '2025-02-10T12:00:00Z', 2_000],
      [2, '2025-03-10T12:00:00Z', 3_000],
    ] as const) {
      await seedExpense(testDb.sql, {
        id: `odo-${i}`,
        vehicleId: CAMRY.id,
        category: 'maintenance',
        expenseAmount: 1_000,
        date: new Date(iso),
        mileage,
        volume: null,
        fuelType: null,
        missedFillup: false,
      });
    }
    const result = await repo.query(
      OWNER.id,
      baseQuery({
        metric: 'distance',
        start: seconds('2025-02-01T00:00:00Z'),
        end: seconds('2025-05-01T00:00:00Z'),
      })
    );
    expect(result.buckets).toEqual(['2025-02', '2025-03', '2025-04']);
    expect(result.series[0]?.values).toEqual([1_000, 1_000, 0]);
    expect(result.totals.distance).toBe(1_000);
    expect(result.totals.value).toBe(1_000);

    const legacy = new AnalyticsRepository(testDb.asyncDb);
    const window = { start: seconds('2025-02-01T00:00:00Z'), end: seconds('2025-05-01T00:00:00Z') };
    const summary = await legacy.getSummary(OWNER.id, window);
    const perDistance = await repo.query(
      OWNER.id,
      baseQuery({ metric: 'costPerDistance', interval: 'none', ...window })
    );
    expect(summary.quickStats.costPerDistance).toBe(2);
    expect(perDistance.totals.value).toBe(summary.quickStats.costPerDistance);
  });

  test('a tag listed twice on one expense counts it once', async () => {
    await seedFleet();
    await testDb.sql.run(`UPDATE expenses SET tags = '["work","work"]' WHERE id = 'other-1'`);
    const tagged = await repo.query(OWNER.id, baseQuery({ interval: 'none', groupBy: 'tag' }));
    expect(tagged.series.find((s) => s.key === 'work')?.values[0]).toBe(12_345 + 12_445);
  });

  test('count, per-bucket and compare periods', async () => {
    await seedFleet();
    const count = await repo.query(
      OWNER.id,
      baseQuery({
        metric: 'count',
        start: seconds('2025-01-01T00:00:00Z'),
        end: seconds('2025-07-01T00:00:00Z'),
        compare: 'prevYear',
      })
    );
    expect(count.buckets).toHaveLength(6);
    expect(count.compare?.buckets).toEqual([
      '2024-01',
      '2024-02',
      '2024-03',
      '2024-04',
      '2024-05',
      '2024-06',
    ]);
    expect(count.totals.perBucket).toBeCloseTo((count.totals.value ?? 0) / 6, 9);
    expect(count.compare?.series[0]?.values).toHaveLength(6);
    expect(count.compare?.totals.value).toBeGreaterThan(0);

    const prev = await repo.query(
      OWNER.id,
      baseQuery({
        start: seconds('2025-01-15T00:00:00Z'),
        end: seconds('2025-04-15T00:00:00Z'),
        compare: 'prevPeriod',
      })
    );
    expect(prev.compare?.series[0]?.values).toHaveLength(prev.buckets.length);
    expect(prev.compare?.buckets).toEqual(['2024-09', '2024-10', '2024-11', '2024-12']);
    expect(prev.compare?.range).toEqual({
      start: seconds('2024-09-15T00:00:00Z'),
      end: seconds('2024-12-15T00:00:00Z'),
    });
  });

  test('cost per distance split by vehicle divides each car by its own distance', async () => {
    await seedFleet();
    const result = await repo.query(
      OWNER.id,
      baseQuery({ metric: 'costPerDistance', interval: 'quarter', groupBy: 'vehicle' })
    );
    for (const series of result.series) {
      expect(series.values.some((v) => v != null && v > 0)).toBe(true);
    }
    expect(result.totals.perBucket).toBeNull();
  });

  test('over the whole range, each car uses the same distance as the fleet total', async () => {
    await seedFleet();
    const whole = (overrides: Partial<AnalyticsQuery>) =>
      repo.query(
        OWNER.id,
        baseQuery({
          interval: 'none',
          groupBy: 'vehicle',
          start: seconds('2024-06-01T00:00:00Z'),
          ...overrides,
        })
      );
    const distance = await whole({ metric: 'distance' });
    const cost = await whole({ metric: 'cost' });
    const perDistance = await whole({ metric: 'costPerDistance' });
    const byCar = (r: typeof distance) =>
      Object.fromEntries(r.series.map((s) => [s.key, s.values[0] ?? 0]));
    const miles = byCar(distance);
    const dollars = byCar(cost);
    const carTotal = Object.values(miles).reduce((a, b) => a + b, 0);
    expect(carTotal).toBeCloseTo(distance.totals.distance, 9);
    for (const [car, value] of Object.entries(byCar(perDistance))) {
      expect(value).toBeCloseTo((dollars[car] ?? 0) / (miles[car] ?? 1), 9);
    }
    const fleetCost = Object.values(dollars).reduce((a, b) => a + b, 0);
    expect(perDistance.totals.value).toBeCloseTo(fleetCost / carTotal, 9);
  });

  test('the average per bucket skips buckets with no data', async () => {
    for (const [id, iso, amount] of [
      ['jan', '2025-01-10T12:00:00Z', 10_000],
      ['mar', '2025-03-10T12:00:00Z', 30_000],
    ] as const) {
      await seedExpense(testDb.sql, {
        id,
        vehicleId: CAMRY.id,
        category: 'maintenance',
        expenseAmount: amount,
        date: new Date(iso),
        mileage: null,
        volume: null,
        fuelType: null,
        missedFillup: false,
      });
    }
    const result = await repo.query(
      OWNER.id,
      baseQuery({ start: seconds('2025-01-01T00:00:00Z'), end: seconds('2025-04-01T00:00:00Z') })
    );
    expect(result.buckets).toEqual(['2025-01', '2025-02', '2025-03']);
    expect(result.series[0]?.values).toEqual([10_000, 0, 30_000]);
    expect(result.totals.value).toBe(40_000);
    expect(result.totals.perBucket).toBe(20_000);
  });

  test('an empty account answers with zero totals and no series', async () => {
    const result = await repo.query(STRANGER.id, baseQuery({ groupBy: 'category' }));
    expect(result.series).toEqual([]);
    expect(result.totals).toEqual({ value: 0, perBucket: null, perDistance: null, distance: 0 });
    const noRange = await repo.query(STRANGER.id, {
      ...baseQuery(),
      start: undefined,
      end: undefined,
    });
    expect(noRange.buckets.length).toBeGreaterThanOrEqual(12);
  });

  test('without a start the range opens at the first expense', async () => {
    await seedFleet();
    const result = await repo.query(OWNER.id, {
      ...baseQuery({ interval: 'year' }),
      start: undefined,
      end: seconds('2026-01-01T00:00:00Z'),
    });
    expect(result.buckets).toEqual(['2024', '2025']);
    expect(result.range.start).toBe(seconds('2024-01-03T00:00:00Z'));
  });

  test('a nonsensical combination is a validation error', async () => {
    await expect(
      repo.query(OWNER.id, baseQuery({ metric: 'efficiency', groupBy: 'category' }))
    ).rejects.toThrow(ValidationError);
  });

  test('money values leave the API in dollars', async () => {
    await seedFleet();
    const result = await repo.query(OWNER.id, baseQuery({ interval: 'none', compare: 'prevYear' }));
    const api = analyticsQueryToApi(result, 100);
    expect(api.series[0]?.values[0]).toBe((result.series[0]?.values[0] ?? 0) / 100);
    expect(api.totals.value).toBe((result.totals.value ?? 0) / 100);
    expect(api.compare?.totals.value).toBe((result.compare?.totals.value ?? 0) / 100);
    const count = analyticsQueryToApi(
      await repo.query(OWNER.id, baseQuery({ metric: 'count', interval: 'none' })),
      100
    );
    expect(count.totals.value).toBe(72 * 3);
  });
});

const PERF_START = Date.UTC(2017, 0, 1) / 1000;
const PERF_SPAN = 8 * 365 * 86_400;
const PERF_ROWS_PER_CAR = 3_334;

function perfRow(vehicle: number, i: number): Array<string | number | null> {
  const fuel = i % 3 !== 0;
  return [
    `perf-${vehicle}-${i}`,
    `perf-${vehicle}`,
    fuel ? 'fuel' : (EXPENSE_CATEGORIES[i % EXPENSE_CATEGORIES.length] ?? 'misc'),
    1_000 + (i % 500),
    Math.floor(PERF_START + (PERF_SPAN * i) / PERF_ROWS_PER_CAR),
    fuel ? 1_000 + i * 30 : null,
    fuel ? 10 : null,
    fuel ? 'Regular' : null,
  ];
}

function seedPerfFleet(sqlite: Database): void {
  sqlite.run("INSERT INTO users (id, email, display_name) VALUES ('perf', 'p@test.com', 'P')");
  const insert = sqlite.prepare(
    "INSERT INTO expenses (id, vehicle_id, user_id, category, expense_amount, date, mileage, volume, fuel_type, missed_fillup) VALUES (?, ?, 'perf', ?, ?, ?, ?, ?, ?, FALSE)"
  );
  sqlite.transaction(() => {
    for (let v = 0; v < 3; v++) {
      sqlite.run(
        "INSERT INTO vehicles (id, user_id, make, model, year) VALUES (?, 'perf', 'Make', 'Model', 2017)",
        [`perf-${v}`]
      );
      for (let i = 0; i < PERF_ROWS_PER_CAR; i++) insert.run(...perfRow(v, i));
    }
  })();
}

describe.skipIf(ON_POSTGRES)('performance guard', () => {
  test('a 10k-expense fleet answers a 24-month category query in at most 4 statements', async () => {
    const sqlite = new Database(':memory:');
    const migrations = loadMigrations();
    applyMigrationsUpTo(sqlite, migrations, migrations.length - 1);
    let statements = 0;
    const db = drizzle(sqlite, {
      schema,
      logger: { logQuery: () => statements++ },
    });
    seedPerfFleet(sqlite);
    const perfRepo = new AnalyticsQueryRepository(openAsyncDatabase(db.$client).db);
    const query = baseQuery({
      groupBy: 'category',
      start: PERF_START + PERF_SPAN - 2 * 365 * 86_400,
      end: PERF_START + PERF_SPAN,
    });
    await perfRepo.query('perf', query);

    statements = 0;
    const began = performance.now();
    const result = await perfRepo.query('perf', query);
    const elapsed = performance.now() - began;
    sqlite.close();

    expect(statements).toBeLessThanOrEqual(4);
    expect(result.buckets.length).toBeGreaterThanOrEqual(24);
    expect(elapsed).toBeLessThan(100);
  });
});

describe('bucket items for drill-down', () => {
  const MARCH = { start: seconds('2024-03-01T00:00:00Z'), end: seconds('2024-04-01T00:00:00Z') };

  test('the parts add up to the bucket value of the query', async () => {
    await seedFleet();
    const query = await repo.query(OWNER.id, baseQuery({ groupBy: 'category' }));
    const march = query.buckets.indexOf('2024-03');
    const bucketTotal = query.series.reduce((sum, s) => sum + (s.values[march] ?? 0), 0);
    const items = await repo.items(OWNER.id, { ...MARCH, include: 'all', limit: 1 });
    const parts =
      (items.fuel?.total ?? 0) +
      items.items.reduce((sum, i) => sum + i.amount, 0) +
      (items.others?.total ?? 0);
    expect(items.total).toBe(bucketTotal);
    expect(parts).toBe(items.total);
    expect(items.fuel?.count).toBeGreaterThan(0);
    expect(items.items).toHaveLength(1);
    expect(items.items[0]?.vehicleName).toMatch(/Toyota Camry|Nissan Leaf/);
  });

  test('a selected segment narrows to its category, car, fuel type or tag', async () => {
    await seedFleet();
    const fleetMarch = await repo.items(OWNER.id, { ...MARCH, include: 'all' });
    const camry = await repo.items(OWNER.id, {
      ...MARCH,
      include: 'all',
      groupBy: 'vehicle',
      keys: [CAMRY.id],
    });
    const leaf = await repo.items(OWNER.id, {
      ...MARCH,
      include: 'all',
      groupBy: 'vehicle',
      keys: [LEAF.id],
    });
    expect(camry.total + leaf.total).toBe(fleetMarch.total);
    const fuel = await repo.items(OWNER.id, {
      ...MARCH,
      include: 'all',
      groupBy: 'category',
      keys: ['fuel'],
    });
    expect(fuel.items).toEqual([]);
    expect(fuel.total).toBe(fuel.fuel?.total ?? -1);
    const regular = await repo.items(OWNER.id, {
      ...MARCH,
      include: 'all',
      groupBy: 'fuelType',
      keys: ['Regular'],
    });
    expect(regular.count).toBeGreaterThan(0);
    expect(regular.total).toBeLessThan(fuel.total);
    const january = {
      start: seconds('2024-01-01T00:00:00Z'),
      end: seconds('2024-02-01T00:00:00Z'),
    };
    const work = await repo.items(OWNER.id, {
      ...january,
      include: 'all',
      groupBy: 'tag',
      keys: ['work'],
    });
    expect(work.count).toBe(2);
    expect(work.items.map((i) => i.id)).toEqual(['other-1']);
    expect(work.fuel?.count).toBe(1);
    const untagged = await repo.items(OWNER.id, {
      ...january,
      include: 'all',
      groupBy: 'tag',
      keys: [''],
    });
    expect(untagged.items.map((i) => i.id)).not.toContain('other-0');
  });

  test('the items match the bar for every split, hidden series and energy metric', async () => {
    await seedFleet();
    await seedExpense(testDb.sql, {
      id: 'blank-type',
      vehicleId: CAMRY.id,
      category: 'fuel',
      expenseAmount: 1_234,
      date: new Date('2024-03-20T12:00:00Z'),
      mileage: null,
      volume: 5,
      fuelType: null,
      missedFillup: false,
    });
    const bucket = async (q: Partial<AnalyticsQuery>, keys?: string[]) => {
      const result = await repo.query(OWNER.id, baseQuery(q));
      const i = result.buckets.indexOf('2024-03');
      return result.series
        .filter((s) => !keys || keys.includes(s.key))
        .reduce((sum, s) => sum + (s.values[i] ?? 0), 0);
    };
    const items = (q: Partial<BucketItemsQuery>) =>
      repo.items(OWNER.id, { ...MARCH, include: 'running', ...q });

    const byType = await items({ groupBy: 'fuelType' });
    expect(byType.total).toBe(await bucket({ include: 'running', groupBy: 'fuelType' }));
    expect(byType.categories).toEqual(['fuel']);
    const blank = await items({ groupBy: 'fuelType', keys: [''] });
    expect(blank.total).toBe(1_234);

    const visible = ['fuel', 'maintenance'];
    const shown = await items({ groupBy: 'category', keys: visible });
    expect(shown.total).toBe(await bucket({ include: 'running', groupBy: 'category' }, visible));
    expect(shown.categories).toEqual(visible);

    const charges = await items({ metric: 'volume', energy: 'electric' });
    expect(charges.categories).toEqual(['fuel']);
    expect(charges.count).toBeGreaterThan(0);
    const leafOnly = await items({ groupBy: 'vehicle', keys: [LEAF.id] });
    const leafCharges = await items({
      metric: 'volume',
      energy: 'electric',
      groupBy: 'vehicle',
      keys: [LEAF.id],
    });
    expect(charges.count).toBe(leafCharges.count);
    expect(leafCharges.total).toBe(leafOnly.fuel?.total ?? -1);
  });

  test("another user's car or an empty selection returns nothing", async () => {
    await seedFleet();
    const foreign = await repo.items(OWNER.id, {
      ...MARCH,
      include: 'all',
      vehicleIds: [OTHER.id],
    });
    expect(foreign).toMatchObject({ total: 0, count: 0, fuel: null, items: [], others: null });
    const none = await repo.items(OWNER.id, {
      ...MARCH,
      include: 'running',
      groupBy: 'category',
      keys: ['financial'],
    });
    expect(none.count).toBe(0);
  });
});

describe.skipIf(ON_POSTGRES)('bucketed queries read expenses by date range, never the whole history', () => {
  async function plansFor(run: () => Promise<unknown>): Promise<string[]> {
    const db = testDb.asyncDb as unknown as {
      all: (query: SQL) => Promise<unknown[]>;
    };
    const original = db.all.bind(db);
    const queries: SQL[] = [];
    db.all = (query: SQL) => {
      queries.push(query);
      return original(query);
    };
    try {
      await run();
    } finally {
      db.all = original;
    }
    const plans: string[] = [];
    for (const query of queries) {
      const { sql: text, params } = new SQLiteSyncDialect().sqlToQuery(query);
      const rows = await testDb.sql.all<{ detail: string }>(`EXPLAIN QUERY PLAN ${text}`, [
        ...(params as never[]),
      ]);
      plans.push(...rows.map((r) => r.detail));
    }
    return plans;
  }

  test.each([
    ['cost by category', baseQuery({ groupBy: 'category', interval: 'week' })],
    ['cost by tag', baseQuery({ groupBy: 'tag' })],
    ['fuel volume', baseQuery({ metric: 'volume', interval: 'week' })],
    ['distance', baseQuery({ metric: 'distance', interval: 'week' })],
  ])('%s', async (_name, query) => {
    await seedFleet();
    const plans = await plansFor(() => repo.query(OWNER.id, query));
    const expenseSteps = plans.filter((detail) => /^(SCAN|SEARCH) e\b/.test(detail));
    expect(expenseSteps.length).toBeGreaterThan(0);
    for (const step of expenseSteps) expect(step).toMatch(/date>\?/);
  });
});

describe('bucket boundaries must be whole seconds', () => {
  test('a fractional boundary in a later bucket row is refused, not truncated', async () => {
    await seedFleet();
    await expect(
      repo.query(OWNER.id, baseQuery({ interval: 'month', end: RANGE.end + 0.5 }))
    ).rejects.toThrow();
    expect(await repo.query(OWNER.id, baseQuery({ interval: 'month' }))).toBeDefined();
  });
});
