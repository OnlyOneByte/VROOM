/**
 * Unit display utilities
 * Note: We don't convert units - users enter values in their preferred units
 * and we just display them accordingly
 */

import { DistanceUnit, VolumeUnit } from '../types';

// ── Conversion factors (exact values) ──────────────────────────────────────────

const MILES_TO_KM = 1.609344;
const GALLONS_US_TO_LITERS = 3.785411784;
const GALLONS_UK_TO_LITERS = 4.54609;

// ── Pure conversion functions ──────────────────────────────────────────────────

/**
 * Convert a distance value between miles and kilometers.
 * Returns the input unchanged when source and target units are identical.
 */
export function convertDistance(value: number, from: DistanceUnit, to: DistanceUnit): number {
  if (from === to) return value;

  if (from === DistanceUnit.MILES && to === DistanceUnit.KILOMETERS) {
    return value * MILES_TO_KM;
  }
  // kilometers → miles
  return value / MILES_TO_KM;
}

/**
 * Convert a volume value between gallons (US), gallons (UK), and liters.
 * Returns the input unchanged when source and target units are identical.
 */
export function convertVolume(value: number, from: VolumeUnit, to: VolumeUnit): number {
  if (from === to) return value;

  // Normalize to liters first, then convert to target
  const toLiters: Record<VolumeUnit, number> = {
    [VolumeUnit.GALLONS_US]: GALLONS_US_TO_LITERS,
    [VolumeUnit.GALLONS_UK]: GALLONS_UK_TO_LITERS,
    [VolumeUnit.LITERS]: 1,
  };

  const liters = value * toLiters[from];
  return liters / toLiters[to];
}

/**
 * Convert a fuel efficiency value (distance/volume) between unit systems.
 * Efficiency = distance / volume, so converting requires applying both
 * the distance factor and the inverse of the volume factor.
 * Returns the input unchanged when both source and target units are identical.
 */
export function convertEfficiency(
  value: number,
  fromDist: DistanceUnit,
  fromVol: VolumeUnit,
  toDist: DistanceUnit,
  toVol: VolumeUnit
): number {
  if (fromDist === toDist && fromVol === toVol) return value;

  // efficiency_new = efficiency_old * (distFactor) / (volFactor)
  // where distFactor converts 1 fromDist unit to toDist units
  // and volFactor converts 1 fromVol unit to toVol units
  const distFactor = convertDistance(1, fromDist, toDist);
  const volFactor = convertVolume(1, fromVol, toVol);

  return (value * distFactor) / volFactor;
}
