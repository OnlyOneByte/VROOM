/**
 * Unit display utilities for frontend
 */

import type { DistanceUnit, VolumeUnit, ChargeUnit, VehicleType } from '$lib/types';

/**
 * Get display label for distance unit
 */
export function getDistanceUnitLabel(unit: DistanceUnit, short = false): string {
	const labels: Record<DistanceUnit, { short: string; long: string }> = {
		miles: { short: 'mi', long: 'miles' },
		kilometers: { short: 'km', long: 'kilometers' }
	};
	return short ? labels[unit].short : labels[unit].long;
}

/**
 * Get display label for volume unit
 */
export function getVolumeUnitLabel(unit: VolumeUnit, short = false): string {
	const labels: Record<VolumeUnit, { short: string; long: string }> = {
		gallons_us: { short: 'gal', long: 'Gallons (US)' },
		gallons_uk: { short: 'gal', long: 'Gallons (UK)' },
		liters: { short: 'L', long: 'Liters' }
	};
	return short ? labels[unit].short : labels[unit].long;
}

/**
 * Get display label for charge unit
 */
export function getChargeUnitLabel(unit: ChargeUnit, short = false): string {
	const labels: Record<ChargeUnit, { short: string; long: string }> = {
		kwh: { short: 'kWh', long: 'kWh' }
	};
	return short ? labels[unit].short : labels[unit].long;
}

/**
 * Check if vehicle type uses liquid fuel
 */
export function usesLiquidFuel(vehicleType: VehicleType): boolean {
	return vehicleType === 'gas' || vehicleType === 'hybrid';
}

/**
 * Check if vehicle type uses electric charge
 */
export function usesElectricCharge(vehicleType: VehicleType): boolean {
	return vehicleType === 'electric' || vehicleType === 'hybrid';
}

/**
 * Get fuel efficiency label (e.g., "MPG", "km/L")
 */
export function getFuelEfficiencyLabel(distanceUnit: DistanceUnit, volumeUnit: VolumeUnit): string {
	const distLabel = getDistanceUnitLabel(distanceUnit, true);
	const volLabel = getVolumeUnitLabel(volumeUnit, true);
	return `${distLabel}/${volLabel}`;
}

/**
 * Get electric efficiency label (e.g., "mi/kWh", "km/kWh")
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
 * Get vehicle type display label
 */
export function getVehicleTypeLabel(vehicleType: VehicleType): string {
	const labels: Record<VehicleType, string> = {
		gas: 'Gas',
		electric: 'Electric',
		hybrid: 'Hybrid'
	};
	return labels[vehicleType];
}
