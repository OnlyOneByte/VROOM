/**
 * Unit display utilities
 * Note: We don't convert units - users enter values in their preferred units
 * and we just display them accordingly
 */

import { ChargeUnit, DistanceUnit, VehicleType, VolumeUnit } from '../types';

/**
 * Get display label for distance unit
 */
export function getDistanceUnitLabel(unit: DistanceUnit, short = false): string {
  const labels: Record<DistanceUnit, { short: string; long: string }> = {
    [DistanceUnit.MILES]: { short: 'mi', long: 'miles' },
    [DistanceUnit.KILOMETERS]: { short: 'km', long: 'kilometers' },
  };
  return short ? labels[unit].short : labels[unit].long;
}

/**
 * Get display label for volume unit
 */
export function getVolumeUnitLabel(unit: VolumeUnit, short = false): string {
  const labels: Record<VolumeUnit, { short: string; long: string }> = {
    [VolumeUnit.GALLONS_US]: { short: 'gal', long: 'gallons (US)' },
    [VolumeUnit.GALLONS_UK]: { short: 'gal', long: 'gallons (UK)' },
    [VolumeUnit.LITERS]: { short: 'L', long: 'liters' },
  };
  return short ? labels[unit].short : labels[unit].long;
}

/**
 * Get display label for charge unit
 */
export function getChargeUnitLabel(unit: ChargeUnit, short = false): string {
  const labels: Record<ChargeUnit, { short: string; long: string }> = {
    [ChargeUnit.KWH]: { short: 'kWh', long: 'kWh' },
  };
  return short ? labels[unit].short : labels[unit].long;
}

/**
 * Get efficiency unit label for fuel (e.g., "MPG", "km/L")
 */
export function getFuelEfficiencyLabel(distanceUnit: DistanceUnit, volumeUnit: VolumeUnit): string {
  const distLabel = getDistanceUnitLabel(distanceUnit, true);
  const volLabel = getVolumeUnitLabel(volumeUnit, true);
  return `${distLabel}/${volLabel}`;
}

/**
 * Get efficiency unit label for electric (e.g., "mi/kWh", "km/kWh")
 */
export function getElectricEfficiencyLabel(
  distanceUnit: DistanceUnit,
  chargeUnit: ChargeUnit
): string {
  const distLabel = getDistanceUnitLabel(distanceUnit, true);
  const chargeLabel = getChargeUnitLabel(chargeUnit, true);
  return `${distLabel}/${chargeLabel}`;
}

/**
 * Check if vehicle type uses liquid fuel
 */
export function usesLiquidFuel(vehicleType: VehicleType): boolean {
  return vehicleType === VehicleType.GAS || vehicleType === VehicleType.HYBRID;
}

/**
 * Check if vehicle type uses electric charge
 */
export function usesElectricCharge(vehicleType: VehicleType): boolean {
  return vehicleType === VehicleType.ELECTRIC || vehicleType === VehicleType.HYBRID;
}

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
