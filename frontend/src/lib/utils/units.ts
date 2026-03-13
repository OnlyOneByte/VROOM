/**
 * Unit display utilities for frontend
 */

import type { DistanceUnit, VolumeUnit, ChargeUnit } from '$lib/types';

/**
 * Electric fuel types — duplicated from backend/src/db/types.ts since frontend
 * and backend can't share code directly. Keep in sync with backend.
 */
export const ELECTRIC_FUEL_TYPES = [
	'Electric',
	'Level 1 (Home)',
	'Level 2 (AC)',
	'DC Fast Charging'
] as const;

/**
 * Check if a fuelType value indicates an electric charging type.
 * Used by the API transformer to decide fuelAmount → volume vs charge mapping.
 */
export function isElectricFuelType(fuelType: string | null | undefined): boolean {
	return (
		fuelType !== null &&
		fuelType !== undefined &&
		ELECTRIC_FUEL_TYPES.includes(fuelType as (typeof ELECTRIC_FUEL_TYPES)[number])
	);
}

/**
 * Get display label for distance unit
 */
export function getDistanceUnitLabel(unit: DistanceUnit, short = false): string {
	const labels: Record<DistanceUnit, { short: string; long: string }> = {
		miles: { short: 'mi', long: 'Miles' },
		kilometers: { short: 'km', long: 'Kilometers' }
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
 * Get cost-per-distance label (e.g., "Cost/mi", "Cost/km")
 */
export function getCostPerDistanceLabel(distanceUnit: DistanceUnit): string {
	return `Cost/${getDistanceUnitLabel(distanceUnit, true)}`;
}

/**
 * Get long-form label for card titles (e.g., "Miles", "Kilometers", "Gallons (US)", "Liters", "kWh")
 */
export function getLongFormLabel(unit: DistanceUnit | VolumeUnit | ChargeUnit): string {
	const labels: Record<DistanceUnit | VolumeUnit | ChargeUnit, string> = {
		miles: 'Miles',
		kilometers: 'Kilometers',
		gallons_us: 'Gallons (US)',
		gallons_uk: 'Gallons (UK)',
		liters: 'Liters',
		kwh: 'kWh'
	};
	return labels[unit];
}
