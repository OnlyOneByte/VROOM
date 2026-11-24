import { and, eq, inArray, type SQL, sql } from 'drizzle-orm';
import type { AppDatabase } from '../../db/connection';
import { getDb } from '../../db/connection';
import { jsonArrayIsEmpty, jsonArraySome, sqlFalse } from '../../db/dialect';
import { userPreferences, vehicles } from '../../db/schema';
import { ELECTRIC_FUEL_TYPES, EXPENSE_CATEGORIES, type ExpenseCategory } from '../../db/types';
import { DatabaseError, ValidationError } from '../../errors';
import { DEFAULT_UNIT_PREFERENCES, parseUnitPreferences, type UnitPreferences } from '../../types';
import { MAX_REASONABLE_MILES_BETWEEN_FILLUPS } from '../../utils/analytics-charts';
import {
  MAX_VALID_MI_KWH,
  MAX_VALID_MPG,
  MIN_VALID_MI_KWH,
  MIN_VALID_MPG,
} from '../../utils/calculations';
import { logger } from '../../utils/logger';
import { zonedMidnight, zonedParts, zoneOffsetMs } from '../../utils/time-zone';
import { canonicalScale, convertDistance, convertVolume } from '../../utils/unit-conversions';
import { ownedVehiclesScope } from '../../utils/vehicle-access';
import { OWNERSHIP_CATEGORIES } from '../expenses/repository';
import {
  type QueryAnnotation,
  type ServiceAnnotation,
  serviceAnnotations,
  type TripLane,
  tripLane,
} from './annotations';

export const QUERY_METRICS = [
  'cost',
  'costPerDistance',
  'distance',
  'volume',
  'efficiency',
  'count',
] as const;
export const QUERY_INTERVALS = ['week', 'month', 'quarter', 'year', 'none'] as const;
export const QUERY_GROUP_BYS = ['none', 'category', 'vehicle', 'fuelType', 'tag'] as const;
export const QUERY_INCLUDES = ['running', 'all'] as const;
export const QUERY_COMPARES = ['none', 'prevPeriod', 'prevYear'] as const;
export const QUERY_ENERGIES = ['fuel', 'electric'] as const;

export type QueryMetric = (typeof QUERY_METRICS)[number];
export type QueryInterval = (typeof QUERY_INTERVALS)[number];
export type QueryGroupBy = (typeof QUERY_GROUP_BYS)[number];
export type QueryInclude = (typeof QUERY_INCLUDES)[number];
export type QueryCompare = (typeof QUERY_COMPARES)[number];
export type QueryEnergy = (typeof QUERY_ENERGIES)[number];

export const RUNNING_CATEGORIES: readonly ExpenseCategory[] = EXPENSE_CATEGORIES.filter(
  (c) => !(OWNERSHIP_CATEGORIES as readonly string[]).includes(c)
);

const ALL_GROUP_BYS = QUERY_GROUP_BYS;

export const GROUP_BYS_FOR_METRIC: Record<QueryMetric, readonly QueryGroupBy[]> = {
  cost: ALL_GROUP_BYS,
  count: ALL_GROUP_BYS,
  costPerDistance: ['none', 'vehicle', 'category'],
  distance: ['none', 'vehicle'],
  volume: ['none', 'vehicle', 'fuelType'],
  efficiency: ['none', 'vehicle', 'fuelType'],
};

export const MAX_QUERY_BUCKETS = 1000;

const DEFAULT_RANGE_SECONDS = 365 * 86_400;
const TOTAL_KEY = 'total';

export interface AnalyticsQuery {
  metric: QueryMetric;
  interval: QueryInterval;
  groupBy: QueryGroupBy;
  vehicleIds?: string[];
  categories?: ExpenseCategory[];
  start?: number;
  end?: number;
  include: QueryInclude;
  compare: QueryCompare;
  energy: QueryEnergy;
  timeZone?: string;
  annotations?: QueryAnnotation[];
}

export interface QuerySeries {
  key: string;
  label: string;
  values: Array<number | null>;
}

export interface QueryTotals {
  value: number | null;
  perBucket: number | null;
  perDistance: number | null;
  distance: number;
}

export interface QueryPeriod {
  range: { start: number; end: number };
  buckets: string[];
  series: QuerySeries[];
  totals: QueryTotals;
}

export interface BucketItemsQuery {
  start: number;
  end: number;
  vehicleIds?: string[];
  categories?: ExpenseCategory[];
  include: QueryInclude;
  metric?: QueryMetric;
  energy?: QueryEnergy;
  groupBy?: QueryGroupBy;
  keys?: string[];
  limit?: number;
}

export interface BucketItem {
  id: string;
  date: number;
  category: string;
  vehicleId: string;
  vehicleName: string;
  description: string | null;
  amount: number;
}

export interface BucketItems {
  total: number;
  count: number;
  fuel: { total: number; count: number } | null;
  items: BucketItem[];
  others: { total: number; count: number } | null;
  categories: string[];
}

export interface AnalyticsQueryResult extends QueryPeriod {
  metric: QueryMetric;
  unit: string;
  interval: QueryInterval;
  groupBy: QueryGroupBy;
  compare: QueryPeriod | null;
  annotations?: ServiceAnnotation[];
  annotationsTruncated?: boolean;
  trips?: TripLane;
}

export interface Bucket {
  key: string;
  start: number;
  end: number;
}

interface VehicleInfo {
  name: string;
  units: UnitPreferences;
}

interface Aggregate {
  cost: number;
  count: number;
  volume: number;
  effDistance: number;
  effEnergy: number;
}

interface PeriodRows {
  byKey: Map<string, Aggregate[]>;
  bucketTotals: Aggregate[];
  distanceByVehicle: Map<string, number[]>;
  rangeDistance: number;
}

interface QueryContext {
  query: AnalyticsQuery;
  userId: string;
  timeZone: string;
  categories: ExpenseCategory[];
  vehicleIds: string[];
  vehicleInfo: Map<string, VehicleInfo>;
  userUnits: UnitPreferences;
  periods: Bucket[][];
}

export function isValidQueryCombination(metric: QueryMetric, groupBy: QueryGroupBy): boolean {
  return GROUP_BYS_FOR_METRIC[metric].includes(groupBy);
}

interface Wall {
  year: number;
  month: number;
  day: number;
}

function normalizeWall(year: number, month: number, day: number): Wall {
  const d = new Date(Date.UTC(year, month, day));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth(), day: d.getUTCDate() };
}

function localDate(seconds: number, timeZone: string): Wall {
  const p = zonedParts(new Date(seconds * 1000), timeZone);
  return { year: p.year, month: p.month - 1, day: p.day };
}

function midnight(year: number, month: number, day: number, timeZone: string): number {
  return Math.floor(zonedMidnight(year, month, day, timeZone).getTime() / 1000);
}

function midnightFinder(timeZone: string): (wall: Wall) => number {
  let offset = 0;
  return (wall) => {
    const utc = Date.UTC(wall.year, wall.month, wall.day);
    if (timeZone === 'UTC') return utc / 1000;
    const guess = utc - offset;
    if (zoneOffsetMs(guess, timeZone) === offset) return guess / 1000;
    const exact = midnight(wall.year, wall.month, wall.day, timeZone);
    offset = utc - exact * 1000;
    return exact;
  };
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

type CalendarInterval = Exclude<QueryInterval, 'none'>;

function bucketStart(date: Wall, interval: CalendarInterval): Wall {
  if (interval === 'year') return { year: date.year, month: 0, day: 1 };
  if (interval === 'quarter')
    return { year: date.year, month: Math.floor(date.month / 3) * 3, day: 1 };
  if (interval === 'month') return { year: date.year, month: date.month, day: 1 };
  const weekday = new Date(Date.UTC(date.year, date.month, date.day)).getUTCDay();
  return normalizeWall(date.year, date.month, date.day - ((weekday + 6) % 7));
}

function nextBucket(wall: Wall, interval: CalendarInterval): Wall {
  if (interval === 'year') return { year: wall.year + 1, month: 0, day: 1 };
  if (interval === 'quarter') return normalizeWall(wall.year, wall.month + 3, 1);
  if (interval === 'month') return normalizeWall(wall.year, wall.month + 1, 1);
  return normalizeWall(wall.year, wall.month, wall.day + 7);
}

function bucketKey(wall: Wall, interval: CalendarInterval): string {
  if (interval === 'year') return String(wall.year);
  if (interval === 'quarter') return `${wall.year}-Q${wall.month / 3 + 1}`;
  if (interval === 'month') return `${wall.year}-${pad(wall.month + 1)}`;
  return `${wall.year}-${pad(wall.month + 1)}-${pad(wall.day)}`;
}

export function buildBuckets(
  range: { start: number; end: number },
  interval: QueryInterval,
  timeZone: string
): Bucket[] {
  if (interval === 'none') return [{ key: TOTAL_KEY, start: range.start, end: range.end }];
  const midnightOf = midnightFinder(timeZone);
  const buckets: Bucket[] = [];
  let wall = bucketStart(localDate(range.start, timeZone), interval);
  let start = midnightOf(wall);
  while (start < range.end) {
    const next = nextBucket(wall, interval);
    const end = midnightOf(next);
    buckets.push({
      key: bucketKey(wall, interval),
      start: Math.max(start, range.start),
      end: Math.min(end, range.end),
    });
    if (buckets.length > MAX_QUERY_BUCKETS) {
      throw new ValidationError(
        `The range holds more than ${MAX_QUERY_BUCKETS} ${interval} buckets; choose a longer interval or a shorter range`
      );
    }
    wall = next;
    start = end;
  }
  return buckets;
}

function shiftLocal(seconds: number, months: number, days: number, timeZone: string): number {
  const { year, month, day } = localDate(seconds, timeZone);
  const sinceMidnight = seconds - midnight(year, month, day, timeZone);
  const lastDay = new Date(Date.UTC(year, month + months + 1, 0)).getUTCDate();
  const wall = normalizeWall(year, month + months, Math.min(day, lastDay) + days);
  return midnight(wall.year, wall.month, wall.day, timeZone) + sinceMidnight;
}

const MONTHS_PER_STEP: Record<Exclude<CalendarInterval, 'week'>, number> = {
  month: 1,
  quarter: 3,
  year: 12,
};

function compareShift(
  interval: QueryInterval,
  compare: Exclude<QueryCompare, 'none'>,
  steps: number
): { months: number; days: number } {
  if (compare === 'prevYear')
    return interval === 'week' ? { months: 0, days: -364 } : { months: -12, days: 0 };
  if (interval === 'week') return { months: 0, days: -7 * steps };
  if (interval === 'none') return { months: 0, days: 0 };
  return { months: -MONTHS_PER_STEP[interval] * steps, days: 0 };
}

export function compareBuckets(
  buckets: Bucket[],
  interval: QueryInterval,
  compare: QueryCompare,
  timeZone: string
): Bucket[] | null {
  const first = buckets[0];
  const last = buckets.at(-1);
  if (compare === 'none' || !first || !last) return null;
  if (interval === 'none' && compare === 'prevPeriod') {
    const length = last.end - first.start;
    return [{ key: TOTAL_KEY, start: first.start - length, end: first.start }];
  }
  const { months, days } = compareShift(interval, compare, buckets.length);
  return buckets.map((b) => {
    const start = shiftLocal(b.start, months, days, timeZone);
    const key =
      interval === 'none'
        ? TOTAL_KEY
        : bucketKey(bucketStart(localDate(start, timeZone), interval), interval);
    return { key, start, end: shiftLocal(b.end, months, days, timeZone) };
  });
}

function emptyAggregate(): Aggregate {
  return { cost: 0, count: 0, volume: 0, effDistance: 0, effEnergy: 0 };
}

function rangeStart(requested: number | undefined, firsts: number[], end: number): number {
  const earliest = firsts.length > 0 ? Math.min(...firsts) : undefined;
  const first = earliest !== undefined && earliest < end ? earliest : undefined;
  const fallback = end - DEFAULT_RANGE_SECONDS;
  if (requested === undefined) return first ?? fallback;
  return Math.max(requested, first ?? fallback);
}

function vehicleName(v: {
  year: number;
  make: string;
  model: string;
  nickname: string | null;
}): string {
  const base = `${v.year} ${v.make} ${v.model}`;
  return v.nickname ? `${base} (${v.nickname})` : base;
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

const METRIC_LABELS: Record<QueryMetric, string> = {
  cost: 'Total cost',
  costPerDistance: 'Cost per distance',
  distance: 'Distance',
  volume: 'Volume',
  efficiency: 'Efficiency',
  count: 'Count',
};

function effectiveCategories(query: AnalyticsQuery): ExpenseCategory[] {
  const base: readonly ExpenseCategory[] =
    query.include === 'all' ? EXPENSE_CATEGORIES : RUNNING_CATEGORIES;
  const picked = query.categories?.length
    ? base.filter((c) => query.categories?.includes(c))
    : [...base];
  if (usesFuelRows(query)) return picked.filter((c) => c === 'fuel');
  return picked;
}

function measuresEnergy(query: AnalyticsQuery): boolean {
  return query.metric === 'volume' || query.metric === 'efficiency';
}

function usesFuelRows(query: AnalyticsQuery): boolean {
  return measuresEnergy(query) || query.groupBy === 'fuelType';
}

function bucketsCte(periods: Bucket[][]): SQL {
  const rows: SQL[] = [];
  periods.forEach((buckets, period) => {
    buckets.forEach((b, idx) => {
      rows.push(sql`(${period}, ${idx}, ${b.start}, ${b.end})`);
    });
  });
  return sql`b(period, idx, t0, t1) AS (VALUES ${sql.join(rows, sql`, `)})`;
}

function unitsCte(ctx: QueryContext): SQL {
  const rows = ctx.vehicleIds.map((id) => {
    const units = ctx.vehicleInfo.get(id)?.units ?? DEFAULT_UNIT_PREFERENCES;
    const canonical = canonicalScale(units);
    const distToUser = convertDistance(1, units.distanceUnit, ctx.userUnits.distanceUnit);
    const volToUser = convertVolume(1, units.volumeUnit, ctx.userUnits.volumeUnit);
    return sql`(${id}, ${canonical.distance}, ${canonical.volume}, ${distToUser}, ${volToUser})`;
  });
  return sql`vu(vehicle_id, dist_canon, vol_canon, dist_user, vol_user) AS (VALUES ${sql.join(rows, sql`, `)})`;
}

function inList(values: readonly string[]): SQL {
  return sql.join(
    values.map((v) => sql`${v}`),
    sql`, `
  );
}

function electricFilter(energy: QueryEnergy): SQL {
  const list = inList(ELECTRIC_FUEL_TYPES);
  return energy === 'electric'
    ? sql`e.fuel_type IN (${list})`
    : sql`(e.fuel_type IS NULL OR e.fuel_type NOT IN (${list}))`;
}

function keyExpression(groupBy: QueryGroupBy): SQL {
  switch (groupBy) {
    case 'category':
      return sql`e.category`;
    case 'vehicle':
      return sql`e.vehicle_id`;
    default:
      return sql`${TOTAL_KEY}`;
  }
}

interface AggregateRow {
  period: number;
  idx: number;
  is_total: number;
  key: string | null;
  cost: number | null;
  n: number;
  volume: number | null;
  eff_distance: number | null;
  eff_energy: number | null;
}

interface DistanceRow {
  period: number;
  idx: number;
  vehicle_id: string;
  distance: number | null;
}

function addInto(sum: Aggregate, value: Aggregate): Aggregate {
  sum.cost += value.cost;
  sum.count += value.count;
  sum.volume += value.volume;
  sum.effDistance += value.effDistance;
  sum.effEnergy += value.effEnergy;
  return sum;
}

function toAggregate(row: AggregateRow): Aggregate {
  return {
    cost: row.cost ?? 0,
    count: row.n,
    volume: row.volume ?? 0,
    effDistance: row.eff_distance ?? 0,
    effEnergy: row.eff_energy ?? 0,
  };
}

function seriesFor<T>(map: Map<string, T[]>, key: string, length: number, fill: () => T): T[] {
  let values = map.get(key);
  if (!values) {
    values = Array.from({ length }, fill);
    map.set(key, values);
  }
  return values;
}

function collectAggregates(ctx: QueryContext, result: PeriodRows[], rows: AggregateRow[]): void {
  for (const row of rows) {
    const period = result[row.period];
    if (!period) continue;
    if (row.is_total === 1) {
      period.bucketTotals[row.idx] = toAggregate(row);
      continue;
    }
    const length = ctx.periods[row.period]?.length ?? 0;
    seriesFor(period.byKey, row.key ?? '', length, emptyAggregate)[row.idx] = toAggregate(row);
  }
}

function sumBucketTotals(result: PeriodRows[]): void {
  for (const period of result) {
    period.bucketTotals = period.bucketTotals.map((_, idx) => {
      const sum = emptyAggregate();
      for (const values of period.byKey.values()) addInto(sum, values[idx] ?? emptyAggregate());
      return sum;
    });
  }
}

function collectDistances(ctx: QueryContext, result: PeriodRows[], rows: DistanceRow[]): void {
  const wholeRange = ctx.query.interval === 'none';
  for (const row of rows) {
    const period = result[row.period];
    if (!period) continue;
    const rangeRow = row.idx < 0;
    if (rangeRow) period.rangeDistance += row.distance ?? 0;
    if (rangeRow !== wholeRange) continue;
    const length = ctx.periods[row.period]?.length ?? 0;
    seriesFor(period.distanceByVehicle, row.vehicle_id, length, () => 0)[rangeRow ? 0 : row.idx] =
      row.distance ?? 0;
  }
}

function itemsWhere(
  userId: string,
  vehicleIds: string[],
  categories: ExpenseCategory[],
  query: BucketItemsQuery,
  groupBy: QueryGroupBy
): SQL {
  const conditions: SQL[] = [
    sql`e.user_id = ${userId}`,
    sql`e.vehicle_id IN (${inList(vehicleIds)})`,
    sql`e.category IN (${inList(categories)})`,
    sql`e.date >= ${query.start}`,
    sql`e.date < ${query.end}`,
  ];
  const keys = query.keys;
  if (groupBy === 'fuelType' && keys) {
    conditions.push(keys.length ? sql`COALESCE(e.fuel_type, '') IN (${inList(keys)})` : sqlFalse);
  }
  if (groupBy === 'tag' && keys) {
    const tagged = keys.filter(Boolean);
    const parts: SQL[] = [];
    if (tagged.length) {
      parts.push(jsonArraySome(sql`e.tags`, (element) => sql`${element} IN (${inList(tagged)})`));
    }
    if (keys.includes('')) parts.push(jsonArrayIsEmpty(sql`e.tags`));
    conditions.push(parts.length ? sql`(${sql.join(parts, sql` OR `)})` : sqlFalse);
  }
  if (query.metric === 'volume' || query.metric === 'efficiency') {
    conditions.push(electricFilter(query.energy ?? 'fuel'));
  }
  return sql.join(conditions, sql` AND `);
}

export class AnalyticsQueryRepository {
  constructor(private db: AppDatabase) {}

  async query(userId: string, query: AnalyticsQuery): Promise<AnalyticsQueryResult> {
    try {
      return await this.run(userId, query);
    } catch (error) {
      if (error instanceof ValidationError) throw error;
      logger.error('Failed to run analytics query', {
        userId,
        metric: query.metric,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new DatabaseError('Failed to run analytics query', error);
    }
  }

  private async run(userId: string, query: AnalyticsQuery): Promise<AnalyticsQueryResult> {
    if (!isValidQueryCombination(query.metric, query.groupBy)) {
      throw new ValidationError(`metric=${query.metric} cannot be grouped by ${query.groupBy}`);
    }
    const { ctx, currency, range, prior } = await this.loadContext(userId, query);
    const rows = this.aggregate(ctx);
    const primary = this.shapePeriod(ctx, 0, range, rows[0]);
    const comparePeriod = prior && rows[1] ? this.shapePeriod(ctx, 1, prior, rows[1]) : null;

    return {
      metric: query.metric,
      unit: this.unitFor(query, ctx.userUnits, currency),
      interval: query.interval,
      groupBy: query.groupBy,
      ...primary,
      compare: comparePeriod,
      ...this.annotate(ctx, range),
    };
  }

  private annotate(ctx: QueryContext, range: { start: number; end: number }) {
    const wanted = ctx.query.annotations ?? [];
    if (wanted.length === 0) return {};
    const scope = {
      userId: ctx.userId,
      vehicleIds: ctx.vehicleIds,
      names: new Map([...ctx.vehicleInfo].map(([id, v]) => [id, v.name])),
      ...range,
    };
    const services = wanted.includes('services') ? serviceAnnotations(this.db, scope) : null;
    return {
      ...(services && {
        annotations: services.services,
        annotationsTruncated: services.truncated,
      }),
      ...(wanted.includes('trips') && {
        trips: tripLane(this.db, scope, ctx.periods[0] ?? [], {
          user: ctx.userUnits,
          byVehicle: new Map([...ctx.vehicleInfo].map(([id, v]) => [id, v.units])),
        }),
      }),
    };
  }

  private async loadContext(userId: string, query: AnalyticsQuery) {
    const timeZone = query.timeZone ?? 'UTC';
    const [prefsRows, vehicleRows] = await Promise.all([
      this.db
        .select({
          unitPreferences: userPreferences.unitPreferences,
          currency: userPreferences.currencyUnit,
        })
        .from(userPreferences)
        .where(eq(userPreferences.userId, userId))
        .limit(1),
      this.selectVehicles(userId, query.vehicleIds),
    ]);
    const prefs = prefsRows[0];
    const userUnits = parseUnitPreferences(prefs?.unitPreferences) ?? {
      ...DEFAULT_UNIT_PREFERENCES,
    };

    const vehicleInfo = new Map<string, VehicleInfo>();
    for (const row of vehicleRows) {
      const units = parseUnitPreferences(row.unitPreferences);
      if (!units) throw new ValidationError(`Vehicle ${row.id} has invalid unit preferences`);
      vehicleInfo.set(row.id, { name: vehicleName(row), units });
    }
    const firsts = vehicleRows.flatMap((row) => (row.earliest == null ? [] : [row.earliest]));

    const end = query.end ?? Math.floor(Date.now() / 1000);
    const start = rangeStart(query.start, firsts, end);
    if (start >= end) throw new ValidationError('start must be before end');
    const range = { start, end };
    const primary = buildBuckets(range, query.interval, timeZone);
    const shifted = compareBuckets(primary, query.interval, query.compare, timeZone);
    const periods = shifted ? [primary, shifted] : [primary];
    const prior = shifted
      ? { start: shifted[0]?.start ?? start, end: shifted.at(-1)?.end ?? start }
      : null;

    const ctx: QueryContext = {
      query,
      userId,
      timeZone,
      categories: effectiveCategories(query),
      vehicleIds: [...vehicleInfo.keys()],
      vehicleInfo,
      userUnits,
      periods,
    };
    return { ctx, currency: prefs?.currency ?? 'USD', range, prior };
  }

  private selectVehicles(userId: string, vehicleIds: string[] | undefined) {
    const conditions: SQL[] = [ownedVehiclesScope(userId)];
    if (vehicleIds?.length) conditions.push(inArray(vehicles.id, vehicleIds));
    return this.db
      .select({
        id: vehicles.id,
        make: vehicles.make,
        model: vehicles.model,
        year: vehicles.year,
        nickname: vehicles.nickname,
        unitPreferences: vehicles.unitPreferences,
        earliest: sql<
          number | null
        >`(SELECT MIN(x.date) FROM expenses x WHERE x.vehicle_id = vehicles.id AND x.user_id = ${userId})`,
      })
      .from(vehicles)
      .where(and(...conditions));
  }

  private aggregate(ctx: QueryContext): PeriodRows[] {
    const result: PeriodRows[] = ctx.periods.map((buckets) => ({
      byKey: new Map(),
      bucketTotals: buckets.map(emptyAggregate),
      distanceByVehicle: new Map(),
      rangeDistance: 0,
    }));
    if (ctx.vehicleIds.length === 0) return result;
    collectAggregates(ctx, result, this.aggregateRows(ctx));
    if (ctx.query.groupBy !== 'tag') sumBucketTotals(result);
    collectDistances(ctx, result, this.distanceAggregate(ctx));
    return result;
  }

  private aggregateRows(ctx: QueryContext): AggregateRow[] {
    if (ctx.categories.length === 0) return [];
    return usesFuelRows(ctx.query) ? this.fuelAggregate(ctx) : this.expenseAggregate(ctx);
  }

  async items(userId: string, query: BucketItemsQuery): Promise<BucketItems> {
    try {
      return await this.loadItems(userId, query);
    } catch (error) {
      logger.error('Failed to load bucket items', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new DatabaseError('Failed to load bucket items', error);
    }
  }

  private async loadItems(userId: string, query: BucketItemsQuery): Promise<BucketItems> {
    const groupBy = query.groupBy ?? 'none';
    const keys = query.keys;
    const owned = await this.selectVehicles(userId, query.vehicleIds);
    const names = new Map(owned.map((v) => [v.id, vehicleName(v)]));
    const vehicleIds = [...names.keys()].filter(
      (id) => groupBy !== 'vehicle' || !keys || keys.includes(id)
    );
    const categories = effectiveCategories({
      metric: query.metric ?? 'cost',
      interval: 'none',
      groupBy,
      include: query.include,
      compare: 'none',
      energy: query.energy ?? 'fuel',
      categories: query.categories,
    }).filter((c) => groupBy !== 'category' || !keys || keys.includes(c));
    const empty: BucketItems = {
      total: 0,
      count: 0,
      fuel: null,
      items: [],
      others: null,
      categories,
    };
    if (vehicleIds.length === 0 || categories.length === 0) return empty;

    const where = itemsWhere(userId, vehicleIds, categories, query, groupBy);
    const limit = query.limit ?? 8;
    const [totals] = this.db.all<{
      total: number | null;
      n: number;
      fuel_total: number | null;
      fuel_n: number;
    }>(sql`
      SELECT SUM(e.expense_amount) AS total, COUNT(*) AS n,
        SUM(CASE WHEN e.category = 'fuel' THEN e.expense_amount END) AS fuel_total,
        COUNT(CASE WHEN e.category = 'fuel' THEN 1 END) AS fuel_n
      FROM expenses e WHERE ${where}
    `);
    const rows = this.db.all<{
      id: string;
      date: number;
      category: string;
      vehicle_id: string;
      description: string | null;
      amount: number;
    }>(sql`
      SELECT e.id, e.date, e.category, e.vehicle_id, e.description, e.expense_amount AS amount
      FROM expenses e WHERE ${where} AND e.category <> 'fuel'
      ORDER BY e.expense_amount DESC, e.date DESC LIMIT ${limit}
    `);
    const total = totals?.total ?? 0;
    const count = totals?.n ?? 0;
    const fuelTotal = totals?.fuel_total ?? 0;
    const fuelCount = totals?.fuel_n ?? 0;
    const listed = rows.reduce((sum, r) => sum + r.amount, 0);
    const othersCount = count - fuelCount - rows.length;
    return {
      total,
      count,
      fuel: fuelCount > 0 ? { total: fuelTotal, count: fuelCount } : null,
      items: rows.map((r) => ({
        id: r.id,
        date: r.date,
        category: r.category,
        vehicleId: r.vehicle_id,
        vehicleName: names.get(r.vehicle_id) ?? 'Unknown vehicle',
        description: r.description,
        amount: r.amount,
      })),
      others: othersCount > 0 ? { total: total - fuelTotal - listed, count: othersCount } : null,
      categories,
    };
  }

  private scope(ctx: QueryContext): SQL {
    return sql`e.user_id = ${ctx.userId} AND e.vehicle_id IN (${inList(ctx.vehicleIds)}) AND e.category IN (${inList(ctx.categories)})`;
  }

  private expenseAggregate(ctx: QueryContext): AggregateRow[] {
    if (ctx.query.groupBy === 'tag') return this.tagAggregate(ctx);
    const key = keyExpression(ctx.query.groupBy);
    return this.db.all<AggregateRow>(sql`
      WITH ${bucketsCte(ctx.periods)}
      SELECT b.period, b.idx, 0 AS is_total, ${key} AS key, SUM(e.expense_amount) AS cost, COUNT(*) AS n,
        NULL AS volume, NULL AS eff_distance, NULL AS eff_energy
      FROM b CROSS JOIN expenses e ON e.date >= b.t0 AND e.date < b.t1
      WHERE ${this.scope(ctx)}
      GROUP BY b.period, b.idx, ${key}
    `);
  }

  private tagAggregate(ctx: QueryContext): AggregateRow[] {
    return this.db.all<AggregateRow>(sql`
      WITH ${bucketsCte(ctx.periods)},
      tagged AS (
        SELECT DISTINCT b.period, b.idx, e.id, e.expense_amount, COALESCE(t.value, '') AS key
        FROM b CROSS JOIN expenses e ON e.date >= b.t0 AND e.date < b.t1
        LEFT JOIN json_each(e.tags) t
        WHERE ${this.scope(ctx)}
      )
      SELECT period, idx, 0 AS is_total, key, SUM(expense_amount) AS cost, COUNT(*) AS n,
        NULL AS volume, NULL AS eff_distance, NULL AS eff_energy
      FROM tagged
      GROUP BY period, idx, key
      UNION ALL
      SELECT b.period, b.idx, 1 AS is_total, NULL AS key, SUM(e.expense_amount) AS cost, COUNT(*) AS n,
        NULL AS volume, NULL AS eff_distance, NULL AS eff_energy
      FROM b CROSS JOIN expenses e ON e.date >= b.t0 AND e.date < b.t1
      WHERE ${this.scope(ctx)}
      GROUP BY b.period, b.idx
    `);
  }

  private fuelAggregate(ctx: QueryContext): AggregateRow[] {
    const electric = ctx.query.energy === 'electric';
    const key =
      ctx.query.groupBy === 'fuelType'
        ? sql`COALESCE(f.fuel_type, '')`
        : ctx.query.groupBy === 'vehicle'
          ? sql`f.vehicle_id`
          : sql`${TOTAL_KEY}`;
    const energyUser = electric ? sql`f.volume` : sql`f.volume * vu.vol_user`;
    const energyCanon = electric ? sql`f.volume` : sql`f.volume * vu.vol_canon`;
    const [min, max] = electric
      ? [MIN_VALID_MI_KWH, MAX_VALID_MI_KWH]
      : [MIN_VALID_MPG, MAX_VALID_MPG];
    const driven = sql`(f.mileage - f.prev_mileage)`;
    const valid = sql`(f.missed_fillup = 0 AND f.mileage > 0 AND f.prev_mileage > 0 AND ${driven} > 0
      AND ${driven} * vu.dist_canon <= ${MAX_REASONABLE_MILES_BETWEEN_FILLUPS} AND f.volume > 0
      AND ${driven} * vu.dist_canon / (${energyCanon}) BETWEEN ${min} AND ${max})`;
    return this.db.all<AggregateRow>(sql`
      WITH ${bucketsCte(ctx.periods)}, ${unitsCte(ctx)},
      f AS (
        SELECT b.period, b.idx, e.vehicle_id, e.fuel_type, e.mileage, e.volume, e.missed_fillup,
          e.expense_amount,
          LAG(e.mileage) OVER (PARTITION BY b.period, e.vehicle_id ORDER BY e.date, e.mileage, e.id) AS prev_mileage
        FROM b CROSS JOIN expenses e ON e.date >= b.t0 AND e.date < b.t1
        WHERE ${this.scope(ctx)} ${measuresEnergy(ctx.query) ? sql`AND ${electricFilter(ctx.query.energy)}` : sql``}
      )
      SELECT f.period, f.idx, 0 AS is_total, ${key} AS key, SUM(f.expense_amount) AS cost, COUNT(*) AS n,
        SUM(CASE WHEN f.volume > 0 THEN ${energyUser} END) AS volume,
        SUM(CASE WHEN ${valid} THEN ${driven} * vu.dist_user END) AS eff_distance,
        SUM(CASE WHEN ${valid} THEN ${energyUser} END) AS eff_energy
      FROM f JOIN vu ON vu.vehicle_id = f.vehicle_id
      GROUP BY f.period, f.idx, ${key}
    `);
  }

  private distanceAggregate(ctx: QueryContext): DistanceRow[] {
    return this.db.all<DistanceRow>(sql`
      WITH ${bucketsCte(ctx.periods)}, ${unitsCte(ctx)},
      p AS (SELECT period, MIN(t0) AS t0 FROM b GROUP BY period),
      raw AS (
        SELECT b.period, b.idx, e.vehicle_id, e.date, e.id, e.mileage
        FROM b CROSS JOIN expenses e ON e.date >= b.t0 AND e.date < b.t1
        WHERE e.user_id = ${ctx.userId} AND e.vehicle_id IN (${inList(ctx.vehicleIds)})
          AND e.mileage IS NOT NULL
        UNION ALL
        SELECT p.period, -2 AS idx, vu.vehicle_id, p.t0 - 1 AS date, '' AS id,
          (SELECT x.mileage FROM expenses x
            WHERE x.user_id = ${ctx.userId} AND x.vehicle_id = vu.vehicle_id
              AND x.mileage IS NOT NULL AND x.date < p.t0
            ORDER BY x.date DESC, x.mileage DESC, x.id DESC LIMIT 1) AS mileage
        FROM p CROSS JOIN vu
      ),
      m AS (
        SELECT raw.*, LAG(raw.mileage) OVER (PARTITION BY raw.period, raw.vehicle_id ORDER BY raw.date, raw.mileage, raw.id) AS prev_mileage
        FROM raw WHERE raw.mileage IS NOT NULL
      )
      SELECT m.period, m.idx, m.vehicle_id,
        SUM(CASE WHEN m.mileage > m.prev_mileage THEN (m.mileage - m.prev_mileage) * vu.dist_user ELSE 0 END) AS distance
      FROM m JOIN vu ON vu.vehicle_id = m.vehicle_id
      WHERE m.idx >= 0
      GROUP BY m.period, m.idx, m.vehicle_id
      UNION ALL
      SELECT m.period, -1 AS idx, m.vehicle_id, (MAX(m.mileage) - MIN(m.mileage)) * vu.dist_user AS distance
      FROM m JOIN vu ON vu.vehicle_id = m.vehicle_id
      WHERE m.idx >= 0
      GROUP BY m.period, m.vehicle_id
    `);
  }

  private unitFor(query: AnalyticsQuery, units: UnitPreferences, currency: string): string {
    const energyUnit = query.energy === 'electric' ? units.chargeUnit : units.volumeUnit;
    switch (query.metric) {
      case 'cost':
        return currency;
      case 'costPerDistance':
        return `${currency}/${units.distanceUnit}`;
      case 'distance':
        return units.distanceUnit;
      case 'volume':
        return energyUnit;
      case 'efficiency':
        return `${units.distanceUnit}/${energyUnit}`;
      default:
        return 'count';
    }
  }

  private labelFor(ctx: QueryContext, key: string): string {
    switch (ctx.query.groupBy) {
      case 'vehicle':
        return ctx.vehicleInfo.get(key)?.name ?? 'Unknown vehicle';
      case 'category':
        return capitalize(key);
      case 'fuelType':
        return key || 'Unspecified';
      case 'tag':
        return key || 'Untagged';
      default:
        return METRIC_LABELS[ctx.query.metric];
    }
  }

  private bucketDistance(rows: PeriodRows, idx: number, vehicleId?: string): number {
    if (vehicleId) return rows.distanceByVehicle.get(vehicleId)?.[idx] ?? 0;
    let total = 0;
    for (const values of rows.distanceByVehicle.values()) total += values[idx] ?? 0;
    return total;
  }

  private valueOf(
    ctx: QueryContext,
    agg: Aggregate,
    rows: PeriodRows,
    idx: number,
    key: string
  ): number | null {
    switch (ctx.query.metric) {
      case 'cost':
        return agg.cost;
      case 'count':
        return agg.count;
      case 'volume':
        return agg.volume;
      case 'efficiency':
        return agg.effEnergy > 0 ? agg.effDistance / agg.effEnergy : null;
      case 'distance':
        return this.bucketDistance(rows, idx, ctx.query.groupBy === 'vehicle' ? key : undefined);
      default: {
        const distance = this.bucketDistance(
          rows,
          idx,
          ctx.query.groupBy === 'vehicle' ? key : undefined
        );
        return distance > 0 ? agg.cost / distance : null;
      }
    }
  }

  private distanceSeries(ctx: QueryContext, rows: PeriodRows): Map<string, Aggregate[]> {
    const buckets = ctx.periods[0]?.length ?? 0;
    if (ctx.query.groupBy !== 'vehicle') {
      return new Map([[TOTAL_KEY, Array.from({ length: buckets }, emptyAggregate)]]);
    }
    return new Map(
      [...rows.distanceByVehicle.keys()].map((id) => [
        id,
        Array.from({ length: buckets }, emptyAggregate),
      ])
    );
  }

  private shapePeriod(
    ctx: QueryContext,
    periodIndex: number,
    range: { start: number; end: number },
    rows: PeriodRows
  ): QueryPeriod {
    const buckets = ctx.periods[periodIndex] ?? [];

    const byKey = ctx.query.metric === 'distance' ? this.distanceSeries(ctx, rows) : rows.byKey;
    const series: Array<QuerySeries & { rank: number }> = [];
    for (const [key, aggs] of byKey) {
      const values = aggs.map((agg, idx) => this.valueOf(ctx, agg, rows, idx, key));
      const rank = values.reduce<number>((sum, v) => sum + (v ?? 0), 0);
      if (ctx.query.metric === 'distance' && rank === 0) continue;
      series.push({ key, label: this.labelFor(ctx, key), values, rank });
    }
    series.sort((a, b) => b.rank - a.rank || a.label.localeCompare(b.label));

    const total = rows.bucketTotals.reduce(addInto, emptyAggregate());
    const distance = rows.rangeDistance;
    const perDistance = distance > 0 ? total.cost / distance : null;
    const value = this.totalValue(ctx.query.metric, total, distance, perDistance);
    const additive = ['cost', 'count', 'volume', 'distance'].includes(ctx.query.metric);
    const moneyMetric = ctx.query.metric === 'cost' || ctx.query.metric === 'costPerDistance';
    const filled = buckets.filter((_, i) => series.some((s) => (s.values[i] ?? 0) !== 0)).length;

    return {
      range,
      buckets: buckets.map((b) => b.key),
      series: series.map(({ rank: _rank, ...s }) => s),
      totals: {
        value,
        perBucket: additive && value != null && filled > 0 ? value / filled : null,
        perDistance: moneyMetric ? perDistance : null,
        distance,
      },
    };
  }

  private totalValue(
    metric: QueryMetric,
    total: Aggregate,
    distance: number,
    perDistance: number | null
  ): number | null {
    switch (metric) {
      case 'cost':
        return total.cost;
      case 'count':
        return total.count;
      case 'volume':
        return total.volume;
      case 'distance':
        return distance;
      case 'efficiency':
        return total.effEnergy > 0 ? total.effDistance / total.effEnergy : null;
      default:
        return perDistance;
    }
  }
}

export const analyticsQueryRepository = new AnalyticsQueryRepository(getDb());
