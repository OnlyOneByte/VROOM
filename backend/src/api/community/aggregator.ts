import { CONFIG } from '../../config';
import type { NewCommunityStat } from '../../db/schema';
import { isElectricFuelType } from '../../db/types';
import { DistanceUnit, type UnitPreferences, VolumeUnit } from '../../types';
import {
  computeEfficiencyPoint,
  sameEnergyPairs,
  sortByVehicleThenDate,
} from '../../utils/analytics-charts';
import { logger } from '../../utils/logger';
import { canonicalScale, convertDistance, convertVolume } from '../../utils/unit-conversions';
import { type CommunityStatsRepository, communityStatsRepository } from './repository';

export type CommunityMetric = 'efficiency' | 'running_cost' | 'maintenance' | 'insurance';
export type CommunityUnit = 'km_per_l' | 'km_per_kwh' | 'cents_per_km' | 'cents_per_year';

export const COMMUNITY_SCHEMA_VERSION = 1;
export const COMMUNITY_WINDOW_MS = 365 * 24 * 60 * 60 * 1000;
export const LOCAL_SCOPE = 'local';
const MIN_EFFICIENCY_INTERVALS = 3;
const MIN_RUNNING_COST_KM = 500;
const RECENT_ACTIVITY_MS = 90 * 24 * 60 * 60 * 1000;
const PUBLISHED_N_STEP = 5;
const EPSILON = 1;
const AGE_BANDS: [maxAge: number, band: string][] = [
  [2, '0-2'],
  [5, '3-5'],
  [9, '6-9'],
  [14, '10-14'],
];

export const PLAUSIBLE_BANDS: Record<CommunityUnit, { lo: number; hi: number; step: number }> = {
  km_per_l: { lo: 2, hi: 60, step: 0.1 },
  km_per_kwh: { lo: 1.5, hi: 13, step: 0.1 },
  cents_per_km: { lo: 1, hi: 200, step: 0.1 },
  cents_per_year: { lo: 0, hi: 2_000_000, step: 1000 },
};

const INSURANCE_BAND = { lo: 5000, hi: 2_000_000, step: 1000 };

export interface CommunityExpense {
  date: Date;
  category: string;
  expenseAmount: number;
  mileage: number | null;
  volume: number | null;
  fuelType: string | null;
  missedFillup: boolean;
  sourceType: string | null;
}

export interface CommunityVehicle {
  ownerId: string;
  vehicleId: string;
  catalogModelId: string | null;
  modelYear: number;
  vehicleType: string;
  unitPreferences: UnitPreferences;
  currency: string;
  region: string | null;
  firstRecordAt: Date | null;
  lastRecordAt: Date | null;
  expenses: CommunityExpense[];
  odometerReadings: number[];
  insurancePremiums: InsurancePremium[];
}

export interface InsurancePremium {
  amount: number;
  termStart: Date;
  termEnd: Date;
}

export interface VehicleSample {
  metric: CommunityMetric;
  bucketKey: string;
  unit: CommunityUnit;
  value: number;
  fields: Pick<
    NewCommunityStat,
    'catalogModelId' | 'modelYear' | 'vehicleType' | 'ageBand' | 'region' | 'currency'
  >;
}

export interface AggregateOptions {
  now: Date;
  minGroup: number;
  uniform?: () => number;
}

export interface AggregateResult {
  rows: NewCommunityStat[];
  published: number;
  suppressed: number;
}

export function ageBand(modelYear: number, now: Date): string {
  const age = Math.max(0, now.getUTCFullYear() - modelYear);
  return AGE_BANDS.find(([maxAge]) => age <= maxAge)?.[1] ?? '15+';
}

function efficiency(vehicle: CommunityVehicle): { unit: CommunityUnit; value: number } | null {
  const electricVehicle = vehicle.vehicleType === 'electric';
  const units = vehicle.unitPreferences;
  const scale = canonicalScale(units);
  const fuelRows = sortByVehicleThenDate(
    vehicle.expenses
      .filter((expense) => expense.category === 'fuel')
      .map((expense) => ({ ...expense, vehicleId: vehicle.vehicleId }))
  );
  let km = 0;
  let energy = 0;
  let intervals = 0;
  for (const [current, previous] of sameEnergyPairs(fuelRows)) {
    const electric = isElectricFuelType(current.fuelType);
    if (electric !== electricVehicle) continue;
    if (!computeEfficiencyPoint(current, previous, scale)) continue;
    const volume = current.volume ?? 0;
    km += convertDistance(
      (current.mileage ?? 0) - (previous.mileage ?? 0),
      units.distanceUnit,
      DistanceUnit.KILOMETERS
    );
    energy += electric ? volume : convertVolume(volume, units.volumeUnit, VolumeUnit.LITERS);
    intervals++;
  }
  if (intervals < MIN_EFFICIENCY_INTERVALS || energy <= 0) return null;
  return { unit: electricVehicle ? 'km_per_kwh' : 'km_per_l', value: km / energy };
}

function distanceKm(vehicle: CommunityVehicle): number {
  const readings = [
    ...vehicle.expenses.flatMap((expense) => (expense.mileage ? [expense.mileage] : [])),
    ...vehicle.odometerReadings,
  ];
  if (readings.length < 2) return 0;
  return convertDistance(
    Math.max(...readings) - Math.min(...readings),
    vehicle.unitPreferences.distanceUnit,
    DistanceUnit.KILOMETERS
  );
}

function sumCents(vehicle: CommunityVehicle, include: (expense: CommunityExpense) => boolean) {
  return vehicle.expenses.filter(include).reduce((sum, expense) => sum + expense.expenseAmount, 0);
}

const isInsurance = (expense: CommunityExpense) => expense.sourceType === 'insurance_term';

export function premiumInWindow(premiums: InsurancePremium[], now: Date): number {
  const windowStart = now.getTime() - COMMUNITY_WINDOW_MS;
  return premiums.reduce((sum, { amount, termStart, termEnd }) => {
    const termMs = termEnd.getTime() - termStart.getTime();
    if (termMs <= 0) return sum;
    const overlapMs =
      Math.min(termEnd.getTime(), now.getTime()) - Math.max(termStart.getTime(), windowStart);
    return overlapMs > 0 ? sum + amount * (overlapMs / termMs) : sum;
  }, 0);
}
const isMaintenance = (expense: CommunityExpense) =>
  expense.category === 'maintenance' && !isInsurance(expense);
const isRunningCost = (expense: CommunityExpense) =>
  (expense.category === 'fuel' || expense.category === 'maintenance') && !isInsurance(expense);

export function vehicleSamples(vehicle: CommunityVehicle, now: Date): VehicleSample[] {
  const samples: VehicleSample[] = [];
  const { vehicleType, currency, region, modelYear, catalogModelId } = vehicle;
  const band = ageBand(modelYear, now);
  const ownedWholeWindow =
    vehicle.firstRecordAt !== null &&
    vehicle.lastRecordAt !== null &&
    vehicle.firstRecordAt.getTime() <= now.getTime() - COMMUNITY_WINDOW_MS &&
    vehicle.lastRecordAt.getTime() >= now.getTime() - RECENT_ACTIVITY_MS;

  const fuel = catalogModelId ? efficiency(vehicle) : null;
  if (fuel && catalogModelId) {
    samples.push({
      metric: 'efficiency',
      bucketKey: `efficiency|${catalogModelId}|${modelYear}|${vehicleType}`,
      unit: fuel.unit,
      value: fuel.value,
      fields: { catalogModelId, modelYear, vehicleType },
    });
  }

  const km = distanceKm(vehicle);
  if (km >= MIN_RUNNING_COST_KM) {
    samples.push({
      metric: 'running_cost',
      bucketKey: `running_cost|${vehicleType}|${currency}|${region ?? '-'}`,
      unit: 'cents_per_km',
      value: sumCents(vehicle, isRunningCost) / km,
      fields: { vehicleType, currency, region },
    });
  }

  if (ownedWholeWindow) {
    samples.push({
      metric: 'maintenance',
      bucketKey: `maintenance|${band}|${vehicleType}|${currency}`,
      unit: 'cents_per_year',
      value: sumCents(vehicle, isMaintenance),
      fields: { ageBand: band, vehicleType, currency },
    });
  }

  if (ownedWholeWindow && region && vehicle.insurancePremiums.length > 0) {
    samples.push({
      metric: 'insurance',
      bucketKey: `insurance|${currency}|${region}|${band}`,
      unit: 'cents_per_year',
      value: premiumInWindow(vehicle.insurancePremiums, now),
      fields: { ageBand: band, region, currency },
    });
  }

  return samples;
}

export function bandFor(metric: CommunityMetric, unit: CommunityUnit) {
  return metric === 'insurance' ? INSURANCE_BAND : PLAUSIBLE_BANDS[unit];
}

export function median(values: number[]): number {
  return quantile(
    [...values].sort((a, b) => a - b),
    0.5
  );
}

function quantile(sorted: number[], q: number): number {
  const position = (sorted.length - 1) * q;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const low = sorted[lower] ?? 0;
  const high = sorted[upper] ?? low;
  return low + (high - low) * (position - lower);
}

function cryptoUniform(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32;
}

function laplace(scale: number, uniform: () => number): number {
  const u = Math.min(Math.max(uniform() - 0.5, -0.4999999), 0.4999999);
  return -scale * Math.sign(u) * Math.log(1 - 2 * Math.abs(u));
}

function publish(
  value: number,
  band: { lo: number; hi: number; step: number },
  noiseScale: number,
  uniform: () => number
): number {
  const noisy = Math.min(Math.max(value + laplace(noiseScale, uniform), band.lo), band.hi);
  return Math.round(Math.round(noisy / band.step) * band.step * 1000) / 1000;
}

export function noiseScaleFor(band: { lo: number; hi: number }, nPublished: number): number {
  return (band.hi - band.lo) / (nPublished * EPSILON);
}

function publishedCount(n: number): number {
  return Math.floor(n / PUBLISHED_N_STEP) * PUBLISHED_N_STEP;
}

interface Bucket {
  sample: VehicleSample;
  byOwner: Map<string, number[]>;
}

function collectBuckets(vehicles: CommunityVehicle[], now: Date): Bucket[] {
  const buckets = new Map<string, Bucket>();
  for (const vehicle of vehicles) {
    for (const sample of vehicleSamples(vehicle, now)) {
      const band = bandFor(sample.metric, sample.unit);
      if (sample.value < band.lo || sample.value > band.hi) continue;
      const bucket = buckets.get(sample.bucketKey) ?? { sample, byOwner: new Map() };
      const ownerValues = bucket.byOwner.get(vehicle.ownerId) ?? [];
      ownerValues.push(sample.value);
      bucket.byOwner.set(vehicle.ownerId, ownerValues);
      buckets.set(sample.bucketKey, bucket);
    }
  }
  return [...buckets.values()];
}

function publishBucket(
  { sample, byOwner }: Bucket,
  options: AggregateOptions,
  uniform: () => number
): NewCommunityStat {
  const n = byOwner.size;
  const nPublished = publishedCount(n);
  const ownerValues = [...byOwner.values()].map(median);
  const band = bandFor(sample.metric, sample.unit);
  const noiseScale = noiseScaleFor(band, nPublished);
  const { fields } = sample;
  return {
    scope: LOCAL_SCOPE,
    metric: sample.metric,
    bucketKey: sample.bucketKey,
    catalogModelId: fields.catalogModelId ?? null,
    modelYear: fields.modelYear ?? null,
    vehicleType: fields.vehicleType ?? null,
    ageBand: fields.ageBand ?? null,
    region: fields.region ?? null,
    currency: fields.currency ?? null,
    unit: sample.unit,
    nPublished,
    mean: publish(
      ownerValues.reduce((sum, value) => sum + value, 0) / n,
      band,
      noiseScale,
      uniform
    ),
    computedAt: options.now,
    schemaVersion: COMMUNITY_SCHEMA_VERSION,
  };
}

export function aggregate(
  vehicles: CommunityVehicle[],
  options: AggregateOptions
): AggregateResult {
  const uniform = options.uniform ?? cryptoUniform;
  const buckets = collectBuckets(vehicles, options.now);
  const rows = buckets
    .filter((bucket) => publishedCount(bucket.byOwner.size) >= options.minGroup)
    .map((bucket) => publishBucket(bucket, options, uniform));
  return { rows, published: rows.length, suppressed: buckets.length - rows.length };
}

export async function refreshCommunityStats(
  repository: CommunityStatsRepository = communityStatsRepository,
  now: Date = new Date()
): Promise<AggregateResult> {
  const started = performance.now();
  const input = await repository.loadOptedIn(new Date(now.getTime() - COMMUNITY_WINDOW_MS), now);
  const result = aggregate(input.vehicles, {
    now,
    minGroup: CONFIG.communityStats.minGroup,
  });
  repository.replaceScope(LOCAL_SCOPE, result.rows, now);
  const ms = Math.round(performance.now() - started);
  logger.info(
    `community stats refreshed: ${result.published} buckets published, ${result.suppressed} suppressed (n<K), ${input.optedInOwners} opted-in owners, ${ms} ms`
  );
  if (ms > CONFIG.communityStats.slowRunWarnMs) {
    logger.warn(`community stats refresh took ${ms} ms`);
  }
  return result;
}

let timer: ReturnType<typeof setTimeout> | null = null;

export function refreshFailureSummary(error: unknown): string {
  const root = error instanceof Error && error.cause instanceof Error ? error.cause : error;
  if (!(root instanceof Error)) return 'unknown error';
  return root === error ? root.name : `${root.name}: ${root.message}`;
}

export async function refreshSafely(
  repository: CommunityStatsRepository = communityStatsRepository
): Promise<void> {
  try {
    await refreshCommunityStats(repository);
  } catch (error) {
    logger.error('community stats refresh failed', { error: refreshFailureSummary(error) });
  }
}

function scheduleNext(delayMs: number): void {
  timer = setTimeout(() => {
    void refreshSafely().finally(() => {
      scheduleNext(
        CONFIG.communityStats.refreshIntervalMs +
          Math.floor(Math.random() * CONFIG.communityStats.maxJitterMs)
      );
    });
  }, delayMs);
}

export function firstRunDelayMs(newest: Date | null, now: Date): number {
  if (!newest) return 0;
  return Math.max(0, newest.getTime() + CONFIG.communityStats.refreshIntervalMs - now.getTime());
}

export async function startCommunityStatsJob(): Promise<void> {
  if (!CONFIG.communityStats.enabled || timer) return;
  const newest = await communityStatsRepository.lastRefreshedAt(LOCAL_SCOPE);
  scheduleNext(firstRunDelayMs(newest, new Date()));
}

export function stopCommunityStatsJob(): void {
  if (timer) clearTimeout(timer);
  timer = null;
}
