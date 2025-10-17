/**
 * Unit display utilities
 * Note: We don't convert units - users enter values in their preferred units
 * and we just display them accordingly
 */

import { ChargeUnit, DistanceUnit, VehicleType, VolumeUnit } from '../types/enums';

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
