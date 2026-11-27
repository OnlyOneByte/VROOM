import { and, eq, inArray, type SQL, sql } from 'drizzle-orm';
import { type AsyncAppDatabase, openAsyncDatabase } from '../../db/async-sqlite';
import type { AppDatabase } from '../../db/connection';
import { rawAll, rawJsonValue } from '../../db/dialect';
import { userPreferences, vehicles } from '../../db/schema';
import { ELECTRIC_FUEL_TYPES } from '../../db/types';
import { DatabaseError } from '../../errors';
import { DEFAULT_UNIT_PREFERENCES, parseUnitPreferences, type UnitPreferences } from '../../types';
import { logger } from '../../utils/logger';
import { formatDateForMessage, formatMoneyForMessage, minorUnitScale } from '../../utils/money';
import { convertDistance, convertVolume } from '../../utils/unit-conversions';
import { ownedVehiclesScope } from '../../utils/vehicle-access';
import {
  type AnalyticsQuery,
  type AnalyticsQueryRepository,
  buildBuckets,
  type QueryEnergy,
  RUNNING_CATEGORIES,
} from './query-repository';

export type InsightId =
  | 'recordMonth'
  | 'repairFree'
  | 'winterPenalty'
  | 'costPerTrip'
  | 'cheapestStation';
export type InsightUnit = 'money' | 'days' | 'percent' | 'moneyPerVolume';

export interface Insight {
  id: InsightId;
  title: string;
  value: number;
  unit: InsightUnit;
  sentence: string;
  query: Record<string, string>;
}

export interface InsightsQuery {
  start: number;
  end: number;
  vehicleIds?: string[];
  timeZone: string;
}

interface Car {
  id: string;
  name: string;
  type: string;
  units: UnitPreferences;
}

interface Context {
  userId: string;
  query: InsightsQuery;
  cars: Car[];
  userUnits: UnitPreferences;
  money: (minor: number) => string;
  scale: number;
}

const DAY = 86_400;
const MIN_MONTHS = 3;
const MIN_STREAK_DAYS = 30;
const MIN_TRIPS = 3;
const MIN_STATION_FILLUPS = 3;
const MIN_WINTER_PENALTY = 5;
const MIN_STATION_SAVING = 0.02;

const ROUTINE_TAGS = new Set([
  'oil-change',
  'tire-rotation',
  'routine',
  'car-wash',
  'detailing',
  'wax',
  'interior-cleaning',
  'inspection',
]);
const ROUTINE_WORDS =
  /\b(oil change|oil and filter|lube|(tire )?rotations?|car wash|wash|detailing|detail|wax|wiper blades?|wipers?|(air|cabin|oil) filter|inspection)\b/i;
const SOUTHERN_ZONES =
  /^(Australia|Antarctica)\/|^Pacific\/(Auckland|Chatham|Fiji|Tongatapu|Apia|Noumea|Efate)|^America\/(Argentina|Santiago|Sao_Paulo|Montevideo|Asuncion|La_Paz|Lima|Punta_Arenas)|^Africa\/(Johannesburg|Maputo|Harare|Windhoek|Gaborone|Maseru|Mbabane|Lusaka|Blantyre|Lubumbashi)|^Indian\/(Mauritius|Reunion)/;

const DISTANCE_WORD: Record<string, string> = { miles: 'mile', kilometers: 'km' };
const DISTANCE_SHORT: Record<string, string> = { miles: 'mi', kilometers: 'km' };
const VOLUME_WORD: Record<string, string> = {
  gallons_us: 'gallon',
  gallons_uk: 'gallon',
  liters: 'liter',
};

export function isRoutineMaintenance(tags: string[] | null, description: string | null): boolean {
  if (tags?.some((t) => ROUTINE_TAGS.has(t.toLowerCase()))) return true;
  return ROUTINE_WORDS.test(description ?? '');
}

export function winterMonths(timeZone: string): number[] {
  return SOUTHERN_ZONES.test(timeZone) ? [6, 7, 8] : [12, 1, 2];
}

interface Streak {
  days: number;
  best: number;
  since: number;
}

export function repairStreak(dates: number[], now: number): Streak | null {
  const since = dates.at(-1);
  if (since === undefined) return null;
  const days = Math.floor((now - since) / DAY);
  const gaps = dates.slice(1).map((d, i) => Math.floor((d - (dates[i] ?? d)) / DAY));
  return { days, best: Math.max(days, ...gaps), since };
}

export function winterPenaltyPercent(
  buckets: string[],
  values: Array<number | null>,
  winter: number[]
): number | null {
  const cold: number[] = [];
  const rest: number[] = [];
  const seasons = new Map<number, number>();
  values.forEach((v, i) => {
    const [year, month] = (buckets[i] ?? '').split('-').map(Number);
    if (!v || !year || !month) return;
    if (!winter.includes(month)) {
      rest.push(v);
      return;
    }
    cold.push(v);
    const season = month === 12 ? year + 1 : year;
    seasons.set(season, (seasons.get(season) ?? 0) + 1);
  });
  const winters = [...seasons.values()].filter((months) => months >= 2).length;
  if (winters < 2 || rest.length < MIN_MONTHS) return null;
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  return round((mean(rest) / mean(cold) - 1) * 100);
}

interface StationRow {
  vehicle_id: string;
  location: string;
  grade: string;
  volume: number;
  amount: number;
}

interface Station {
  name: string;
  volume: number;
  amount: number;
  n: number;
}

function groupStations(fills: StationRow[]): Map<string, Station[]> {
  const grades = new Map<string, Map<string, Station>>();
  for (const fill of fills) {
    const stations = grades.get(fill.grade) ?? new Map<string, Station>();
    const key = fill.location.toLowerCase();
    const s = stations.get(key) ?? { name: fill.location, volume: 0, amount: 0, n: 0 };
    s.volume += fill.volume;
    s.amount += fill.amount;
    s.n += 1;
    stations.set(key, s);
    grades.set(fill.grade, stations);
  }
  return new Map([...grades].map(([grade, stations]) => [grade, [...stations.values()]]));
}

export function cheapestStation(fills: StationRow[]) {
  let best: { station: Station; price: number; otherPrice: number; grade: string } | null = null;
  for (const [grade, all] of groupStations(fills)) {
    for (const station of all.filter((s) => s.n >= MIN_STATION_FILLUPS)) {
      const others = all.filter((s) => s !== station);
      const otherCount = others.reduce((a, s) => a + s.n, 0);
      const otherVolume = others.reduce((a, s) => a + s.volume, 0);
      if (otherCount < MIN_STATION_FILLUPS || otherVolume <= 0) continue;
      const price = station.amount / station.volume;
      const otherPrice = others.reduce((a, s) => a + s.amount, 0) / otherVolume;
      const saving = 1 - price / otherPrice;
      if (saving >= MIN_STATION_SAVING && (!best || saving > 1 - best.price / best.otherPrice)) {
        best = { station, price, otherPrice, grade };
      }
    }
  }
  return best;
}

function round(value: number, digits = 0): number {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

function monthName(key: string): string {
  const [year, month] = key.split('-').map(Number);
  return formatDateForMessage(new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, 1)), {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function dayName(seconds: number, timeZone: string): string {
  return formatDateForMessage(new Date(seconds * 1000), {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone,
  });
}

function carName(v: { year: number; make: string; model: string; nickname: string | null }) {
  return v.nickname || `${v.year} ${v.make} ${v.model}`;
}

export class AnalyticsInsightsRepository {
  private db: AsyncAppDatabase;

  constructor(
    syncDb: AppDatabase,
    private queries: AnalyticsQueryRepository
  ) {
    this.db = openAsyncDatabase(syncDb.$client).db;
  }

  async insights(userId: string, query: InsightsQuery): Promise<Insight[]> {
    try {
      const ctx = await this.context(userId, query);
      if (ctx.cars.length === 0) return [];
      const found = await Promise.all([
        this.recordMonth(ctx),
        this.repairFree(ctx),
        this.winterPenalty(ctx),
        this.costPerTrip(ctx),
        this.cheapestStation(ctx),
      ]);
      return found.filter((i): i is Insight => i !== null);
    } catch (error) {
      logger.error('Failed to build analytics insights', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new DatabaseError('Failed to build analytics insights', error);
    }
  }

  private async context(userId: string, query: InsightsQuery): Promise<Context> {
    const conditions: SQL[] = [ownedVehiclesScope(userId)];
    if (query.vehicleIds?.length) conditions.push(inArray(vehicles.id, query.vehicleIds));
    const [prefs, rows] = await Promise.all([
      this.db
        .select({ units: userPreferences.unitPreferences, currency: userPreferences.currencyUnit })
        .from(userPreferences)
        .where(eq(userPreferences.userId, userId))
        .limit(1),
      this.db
        .select({
          id: vehicles.id,
          year: vehicles.year,
          make: vehicles.make,
          model: vehicles.model,
          nickname: vehicles.nickname,
          type: vehicles.vehicleType,
          units: vehicles.unitPreferences,
        })
        .from(vehicles)
        .where(and(...conditions)),
    ]);
    const currency = prefs[0]?.currency ?? 'USD';
    return {
      userId,
      query,
      userUnits: parseUnitPreferences(prefs[0]?.units) ?? { ...DEFAULT_UNIT_PREFERENCES },
      cars: rows.map((r) => ({
        id: r.id,
        name: carName(r),
        type: r.type,
        units: parseUnitPreferences(r.units) ?? { ...DEFAULT_UNIT_PREFERENCES },
      })),
      money: (minor) => formatMoneyForMessage(minor, currency),
      scale: minorUnitScale(currency),
    };
  }

  private base(ctx: Context, overrides: Partial<AnalyticsQuery>): AnalyticsQuery {
    return {
      metric: 'cost',
      interval: 'month',
      groupBy: 'none',
      include: 'all',
      compare: 'none',
      energy: 'fuel',
      start: ctx.query.start,
      end: ctx.query.end,
      timeZone: ctx.query.timeZone,
      vehicleIds: ctx.cars.map((c) => c.id),
      ...overrides,
    };
  }

  private async recordMonth(ctx: Context): Promise<Insight | null> {
    const result = await this.queries.query(ctx.userId, this.base(ctx, { include: 'running' }));
    const values = result.series[0]?.values ?? [];
    const months = values.flatMap((v, i) => (v ? [{ i, v }] : []));
    if (months.length < MIN_MONTHS) return null;
    const best = months.reduce((a, b) => (b.v > a.v ? b : a));
    const key = result.buckets[best.i] ?? '';
    const bucket = buildBuckets(result.range, 'month', ctx.query.timeZone).find(
      (b) => b.key === key
    );
    if (!bucket) return null;
    const [largest] = await rawAll<{
      description: string | null;
      category: string;
      vehicle_id: string;
      amount: number;
    }>(
      this.db,
      sql`
      SELECT e.description, e.category, e.vehicle_id, e.expense_amount AS amount FROM expenses e
      WHERE e.user_id = ${ctx.userId} AND e.vehicle_id IN (${sql.join(
        ctx.cars.map((c) => sql`${c.id}`),
        sql`, `
      )}) AND e.category IN (${sql.join(
        RUNNING_CATEGORIES.map((c) => sql`${c}`),
        sql`, `
      )}) AND e.date >= ${bucket.start} AND e.date < ${bucket.end}
      ORDER BY e.expense_amount DESC LIMIT 1
    `
    );
    const car = ctx.cars.find((c) => c.id === largest?.vehicle_id);
    const what = largest
      ? ` The largest expense was ${largest.description || largest.category}${car && ctx.cars.length > 1 ? ` on the ${car.name}` : ''} (${ctx.money(largest.amount)}).`
      : '';
    return {
      id: 'recordMonth',
      title: 'Record month',
      value: best.v / ctx.scale,
      unit: 'money',
      sentence: `${monthName(key)} had the highest running costs in this period.${what}`,
      query: { metric: 'cost', per: 'month', split: 'category', sel: key },
    };
  }

  private async repairFree(ctx: Context): Promise<Insight | null> {
    const rows = await rawAll<{
      vehicle_id: string;
      date: number;
      tags: string | null;
      description: string | null;
    }>(
      this.db,
      sql`
      SELECT e.vehicle_id, e.date, e.tags, e.description FROM expenses e
      WHERE e.user_id = ${ctx.userId} AND e.category = 'maintenance' AND e.date < ${ctx.query.end}
        AND e.vehicle_id IN (${sql.join(
          ctx.cars.map((c) => sql`${c.id}`),
          sql`, `
        )})
      ORDER BY e.date
    `
    );
    const repairs = new Map<string, number[]>();
    for (const row of rows) {
      const tags = rawJsonValue<string[]>(row.tags);
      if (isRoutineMaintenance(tags, row.description)) continue;
      repairs.set(row.vehicle_id, [...(repairs.get(row.vehicle_id) ?? []), row.date]);
    }
    const now = Math.floor(Date.now() / 1000);
    if (ctx.query.end < now - 2 * DAY) return null;
    let pick: ({ car: Car } & Streak) | null = null;
    for (const car of ctx.cars) {
      const streak = repairStreak(repairs.get(car.id) ?? [], now);
      if (streak && streak.days >= MIN_STREAK_DAYS && (!pick || streak.days > pick.days)) {
        pick = { car, ...streak };
      }
    }
    if (!pick) return null;
    const record =
      pick.best > pick.days
        ? ` Its longest stretch was ${pick.best} days.`
        : ' That is its longest stretch yet.';
    return {
      id: 'repairFree',
      title: 'Repair-free streak',
      value: pick.days,
      unit: 'days',
      sentence: `${pick.car.name}: no repairs since ${dayName(pick.since, ctx.query.timeZone)}. Oil changes, rotations and washes don't count.${record}`,
      query: { metric: 'cost', per: 'month', split: 'category', range: 'all', cars: pick.car.id },
    };
  }

  private async winterPicks(ctx: Context, energy: QueryEnergy, winter: number[]) {
    const cars = ctx.cars.filter((c) =>
      energy === 'electric' ? c.type === 'electric' || c.type === 'hybrid' : c.type === 'hybrid'
    );
    if (cars.length === 0) return [];
    const result = await this.queries.query(
      ctx.userId,
      this.base(ctx, {
        metric: 'efficiency',
        groupBy: 'vehicle',
        energy,
        start: undefined,
        vehicleIds: cars.map((c) => c.id),
      })
    );
    return result.series.flatMap((series) => {
      const car = cars.find((c) => c.id === series.key);
      const penalty = winterPenaltyPercent(result.buckets, series.values, winter);
      return car && penalty !== null && penalty >= MIN_WINTER_PENALTY
        ? [{ car, penalty, energy }]
        : [];
    });
  }

  private async winterPenalty(ctx: Context): Promise<Insight | null> {
    const winter = winterMonths(ctx.query.timeZone);
    const picks = [
      ...(await this.winterPicks(ctx, 'electric', winter)),
      ...(await this.winterPicks(ctx, 'fuel', winter)),
    ];
    const pick = picks.reduce<(typeof picks)[number] | null>(
      (a, b) => (!a || b.penalty > a.penalty ? b : a),
      null
    );
    if (!pick) return null;
    const distance = DISTANCE_WORD[ctx.userUnits.distanceUnit] ?? 'mile';
    const amount =
      pick.energy === 'electric' ? 'kWh' : (VOLUME_WORD[ctx.userUnits.volumeUnit] ?? 'gallon');
    const months = winter
      .map((m) =>
        formatDateForMessage(new Date(Date.UTC(2000, m - 1, 1)), {
          month: 'short',
          timeZone: 'UTC',
        })
      )
      .join(', ');
    return {
      id: 'winterPenalty',
      title: 'Winter penalty',
      value: pick.penalty,
      unit: 'percent',
      sentence: `${pick.car.name} uses ${pick.penalty}% more ${amount === 'kWh' ? 'kWh' : `${amount}s`} per ${distance} in ${months} than in the rest of the year.`,
      query: {
        metric: pick.energy === 'electric' ? 'evEfficiency' : 'mpg',
        per: 'month',
        split: 'vehicle',
        range: 'all',
        cars: pick.car.id,
      },
    };
  }

  private async costPerTrip(ctx: Context): Promise<Insight | null> {
    const trips = await rawAll<{ vehicle_id: string; distance: number; purpose: string }>(
      this.db,
      sql`
      SELECT t.vehicle_id, t.end_odometer - t.start_odometer AS distance, t.purpose FROM trips t
      WHERE t.user_id = ${ctx.userId} AND t.trip_date >= ${ctx.query.start} AND t.trip_date < ${ctx.query.end}
        AND t.end_odometer > t.start_odometer AND t.vehicle_id IN (${sql.join(
          ctx.cars.map((c) => sql`${c.id}`),
          sql`, `
        )})
    `
    );
    if (trips.length < MIN_TRIPS) return null;
    const result = await this.queries.query(
      ctx.userId,
      this.base(ctx, { metric: 'costPerDistance', interval: 'none', include: 'running' })
    );
    const perDistance = result.totals.value;
    if (!perDistance) return null;
    const user = ctx.userUnits.distanceUnit;
    const distances = trips.map((t) => {
      const from = ctx.cars.find((c) => c.id === t.vehicle_id)?.units.distanceUnit ?? user;
      return { d: convertDistance(t.distance, from, user), business: t.purpose === 'business' };
    });
    const total = distances.reduce((a, t) => a + t.d, 0);
    const average = total / distances.length;
    const cost = perDistance * average;
    const business = distances.reduce((a, t) => a + (t.business ? t.d : 0), 0);
    const share = round((business / total) * 100);
    const short = DISTANCE_SHORT[user] ?? 'mi';
    return {
      id: 'costPerTrip',
      title: 'Cost per trip',
      value: round(cost) / ctx.scale,
      unit: 'money',
      sentence: `Your average trip is ${round(average)} ${short}, at ${ctx.money(perDistance)} per ${DISTANCE_WORD[user] ?? 'mile'} in running costs.${share > 0 ? ` ${share}% of trip distance was for business.` : ''}`,
      query: { metric: 'costPerDistance', per: 'month', split: 'vehicle' },
    };
  }

  private async cheapestStation(ctx: Context): Promise<Insight | null> {
    const rows = await rawAll<StationRow>(
      this.db,
      sql`
      SELECT e.vehicle_id, TRIM(e.location) AS location, COALESCE(e.fuel_type, '') AS grade, e.volume,
        e.expense_amount AS amount FROM expenses e
      WHERE e.user_id = ${ctx.userId} AND e.category = 'fuel' AND e.volume > 0 AND e.expense_amount > 0
        AND e.date >= ${ctx.query.start} AND e.date < ${ctx.query.end}
        AND e.location IS NOT NULL AND TRIM(e.location) <> ''
        AND (e.fuel_type IS NULL OR e.fuel_type NOT IN (${sql.join(
          ELECTRIC_FUEL_TYPES.map((t) => sql`${t}`),
          sql`, `
        )}))
        AND e.vehicle_id IN (${sql.join(
          ctx.cars.map((c) => sql`${c.id}`),
          sql`, `
        )})
      ORDER BY e.date DESC
    `
    );
    const user = ctx.userUnits.volumeUnit;
    const fills = rows.map((row) => {
      const from = ctx.cars.find((c) => c.id === row.vehicle_id)?.units.volumeUnit ?? user;
      return { ...row, volume: convertVolume(row.volume, from, user) };
    });
    const pick = cheapestStation(fills);
    if (!pick) return null;
    const { station, price, otherPrice, grade } = pick;
    const unit = VOLUME_WORD[user] ?? 'gallon';
    return {
      id: 'cheapestStation',
      title: 'Cheapest station',
      value: round(price) / ctx.scale,
      unit: 'moneyPerVolume',
      sentence: `${station.name} averaged ${ctx.money(price)} per ${unit}${grade ? ` of ${grade}` : ''} over ${station.n} fill-ups, ${ctx.money(otherPrice - price)} less than your other stations.`,
      query: { metric: 'cost', per: 'month', split: 'fuelType' },
    };
  }
}
