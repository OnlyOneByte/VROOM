import { Hono } from 'hono';
import { z } from 'zod';
import { CONFIG } from '../../config';
import type { CommunityStat } from '../../db/schema';
import { NotFoundError } from '../../errors';
import { requireAuth } from '../../middleware';
import { authorize } from '../../permissions/authorize';
import { DistanceUnit, type UnitPreferences, VolumeUnit } from '../../types';
import { convertDistance, convertEfficiency } from '../../utils/unit-conversions';
import { zValidator } from '../../utils/validation';
import { requireVehicleAccess } from '../../utils/vehicle-access';
import {
  bandFor,
  COMMUNITY_WINDOW_MS,
  type CommunityMetric,
  type CommunityUnit,
  LOCAL_SCOPE,
  noiseScaleFor,
  publishedCount,
  vehicleSamples,
} from './aggregator';
import { communityStatsRepository } from './repository';

export const GIVE_TO_GET = true;
export const MAX_NOISE_SHARE = 0.25;

export function usefulEnough(
  row: Pick<CommunityStat, 'mean' | 'nPublished'> &
    Partial<Pick<CommunityStat, 'catalogModelId' | 'modelYear' | 'vehicleType'>>,
  metric: CommunityMetric,
  unit: CommunityUnit
): boolean {
  const scale = noiseScaleFor(bandFor(metric, unit, row), row.nPublished);
  return row.mean > 0 && scale <= MAX_NOISE_SHARE * row.mean;
}

const METRICS: CommunityMetric[] = ['efficiency', 'running_cost', 'maintenance', 'insurance'];
const OWNER_REGION_METRICS: ReadonlySet<CommunityMetric> = new Set(['running_cost', 'insurance']);

export type CompareStatus =
  | 'ok'
  | 'too_few'
  | 'no_data'
  | 'needs_model'
  | 'opt_in_required'
  | 'awaiting_refresh'
  | 'not_enough_data'
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
    computedAt: row.computedAt.toISOString(),
  };
}

const compareQuerySchema = z.object({ vehicleId: z.string().min(1).max(64) });

const routes = new Hono();

routes.use('*', requireAuth);

routes.get(
  '/compare',
  zValidator('query', compareQuerySchema),
  authorize((c) => ({ kind: 'vehicle', vehicleId: c.req.query('vehicleId') ?? '' })),
  async (c) => {
    const user = c.get('user');
    const { vehicleId } = c.req.valid('query');
    const { ownerId } = await requireVehicleAccess(vehicleId, user.id, 'read');

    if (CONFIG.communityStats.mode === 'off') {
      return c.json({
        success: true,
        data: { currency: null, metrics: emptyMetrics('feature_off') },
      });
    }
    const contribution = await communityStatsRepository.contribution(user.id, LOCAL_SCOPE);
    if (GIVE_TO_GET && contribution !== 'included') {
      return c.json({
        success: true,
        data: {
          currency: null,
          metrics: emptyMetrics(
            contribution === 'opted_out' ? 'opt_in_required' : 'awaiting_refresh'
          ),
        },
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
    const smallestPublished = publishedCount(CONFIG.communityStats.minGroup);
    const rows = await communityStatsRepository.publishedBuckets(
      LOCAL_SCOPE,
      samples.map((sample) => sample.bucketKey),
      smallestPublished
    );
    const rowByKey = new Map(
      rows.filter((row) => row.nPublished >= smallestPublished).map((row) => [row.bucketKey, row])
    );

    const metrics = METRICS.map((metric): CompareMetric => {
      if (ownerId !== user.id && OWNER_REGION_METRICS.has(metric)) {
        return { metric, status: 'no_data', unit: null, yours: null, bucket: null };
      }
      if (metric === 'efficiency' && !vehicle.catalogModelId) {
        return { metric, status: 'needs_model', unit: null, yours: null, bucket: null };
      }
      const sample = samples.find((candidate) => candidate.metric === metric);
      if (!sample) return { metric, status: 'no_data', unit: null, yours: null, bucket: null };
      const unit = DISPLAY_UNIT[sample.unit];
      const yours = toDisplayUnits(sample.value, sample.unit, vehicle.unitPreferences);
      const row = rowByKey.get(sample.bucketKey);
      if (!row) return { metric, status: 'too_few', unit, yours, bucket: null };
      if (!usefulEnough(row, sample.metric, sample.unit)) {
        return { metric, status: 'not_enough_data', unit, yours, bucket: null };
      }
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
  }
);

export { routes };
