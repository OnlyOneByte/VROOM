import { Hono } from 'hono';
import { z } from 'zod';
import { CONFIG } from '../../config';
import type { CommunityStat } from '../../db/schema';
import { NotFoundError } from '../../errors';
import { requireAuth } from '../../middleware';
import { DistanceUnit, type UnitPreferences, VolumeUnit } from '../../types';
import { convertDistance, convertEfficiency } from '../../utils/unit-conversions';
import { zValidator } from '../../utils/validation';
import { requireVehicleAccess } from '../../utils/vehicle-access';
import {
  COMMUNITY_WINDOW_MS,
  type CommunityMetric,
  type CommunityUnit,
  LOCAL_SCOPE,
  vehicleSamples,
} from './aggregator';
import { communityStatsRepository } from './repository';

export const GIVE_TO_GET = true;

const METRICS: CommunityMetric[] = ['efficiency', 'running_cost', 'maintenance', 'insurance'];

export type CompareStatus =
  | 'ok'
  | 'too_few'
  | 'no_data'
  | 'needs_model'
  | 'opt_in_required'
  | 'feature_off';

export type DisplayUnit =
  | 'distance_per_volume'
  | 'distance_per_charge'
  | 'cents_per_distance'
  | 'cents_per_year';

export interface CompareMetric {
  metric: CommunityMetric;
  status: CompareStatus;
  unit: DisplayUnit | null;
  yours: number | null;
  bucket: {
    n: number;
    mean: number;
    p25: number | null;
    p50: number;
    p75: number | null;
    computedAt: string;
  } | null;
}

const DISPLAY_UNIT: Record<CommunityUnit, DisplayUnit> = {
  km_per_l: 'distance_per_volume',
  km_per_kwh: 'distance_per_charge',
  cents_per_km: 'cents_per_distance',
  cents_per_year: 'cents_per_year',
};

export function toDisplayUnits(value: number, unit: CommunityUnit, units: UnitPreferences): number {
  switch (unit) {
    case 'km_per_l':
      return convertEfficiency(
        value,
        DistanceUnit.KILOMETERS,
        VolumeUnit.LITERS,
        units.distanceUnit,
        units.volumeUnit
      );
    case 'km_per_kwh':
      return convertDistance(value, DistanceUnit.KILOMETERS, units.distanceUnit);
    case 'cents_per_km':
      return value / convertDistance(1, DistanceUnit.KILOMETERS, units.distanceUnit);
    case 'cents_per_year':
      return value;
  }
}

function emptyMetrics(status: CompareStatus): CompareMetric[] {
  return METRICS.map((metric) => ({ metric, status, unit: null, yours: null, bucket: null }));
}

function bucketView(row: CommunityStat, unit: CommunityUnit, units: UnitPreferences) {
  const convert = (value: number) => toDisplayUnits(value, unit, units);
  return {
    n: row.nPublished,
    mean: convert(row.mean),
    p25: row.p25 === null ? null : convert(row.p25),
    p50: convert(row.p50),
    p75: row.p75 === null ? null : convert(row.p75),
    computedAt: row.computedAt.toISOString(),
  };
}

const compareQuerySchema = z.object({ vehicleId: z.string().min(1).max(64) });

const routes = new Hono();

routes.use('*', requireAuth);

routes.get('/compare', zValidator('query', compareQuerySchema), async (c) => {
  const user = c.get('user');
  const { vehicleId } = c.req.valid('query');
  await requireVehicleAccess(vehicleId, user.id, 'read');

  if (CONFIG.communityStats.mode === 'off') {
    return c.json({
      success: true,
      data: { currency: null, metrics: emptyMetrics('feature_off') },
    });
  }
  if (GIVE_TO_GET && !(await communityStatsRepository.isOptedIn(user.id))) {
    return c.json({
      success: true,
      data: { currency: null, metrics: emptyMetrics('opt_in_required') },
    });
  }

  const now = new Date();
  const vehicle = await communityStatsRepository.loadVehicle(
    vehicleId,
    new Date(now.getTime() - COMMUNITY_WINDOW_MS),
    now
  );
  if (!vehicle) throw new NotFoundError('Vehicle');

  const samples = vehicleSamples(vehicle, now);
  const rows = await communityStatsRepository.publishedBuckets(
    LOCAL_SCOPE,
    samples.map((sample) => sample.bucketKey),
    CONFIG.communityStats.minGroup
  );
  const rowByKey = new Map(
    rows
      .filter((row) => row.nPublished >= CONFIG.communityStats.minGroup)
      .map((row) => [row.bucketKey, row])
  );

  const metrics = METRICS.map((metric): CompareMetric => {
    if (metric === 'efficiency' && !vehicle.catalogModelId) {
      return { metric, status: 'needs_model', unit: null, yours: null, bucket: null };
    }
    const sample = samples.find((candidate) => candidate.metric === metric);
    if (!sample) return { metric, status: 'no_data', unit: null, yours: null, bucket: null };
    const unit = DISPLAY_UNIT[sample.unit];
    const yours = toDisplayUnits(sample.value, sample.unit, vehicle.unitPreferences);
    const row = rowByKey.get(sample.bucketKey);
    if (!row) return { metric, status: 'too_few', unit, yours, bucket: null };
    return {
      metric,
      status: 'ok',
      unit,
      yours,
      bucket: bucketView(row, sample.unit, vehicle.unitPreferences),
    };
  });

  return c.json({
    success: true,
    data: { currency: vehicle.currency, units: vehicle.unitPreferences, metrics },
  });
});

export { routes };
