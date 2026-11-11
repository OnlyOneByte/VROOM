import type { DistanceUnit, VolumeUnit, ChargeUnit } from '$lib/types';

// Must match backend/src/db/types.ts, which routes charge vs volume by it; a parity test guards drift.
export const ELECTRIC_FUEL_TYPES = [
	'Electric',
	'Level 1 (Home)',
	'Level 2 (AC)',
	'DC Fast Charging'
] as const;

export function isElectricFuelType(fuelType: string | null | undefined): boolean {
	return (
		fuelType !== null &&
		fuelType !== undefined &&
		ELECTRIC_FUEL_TYPES.includes(fuelType as (typeof ELECTRIC_FUEL_TYPES)[number])
	);
}

export function getDistanceUnitLabel(unit: DistanceUnit, short = false): string {
	const labels: Record<DistanceUnit, { short: string; long: string }> = {
		miles: { short: 'mi', long: 'Miles' },
		kilometers: { short: 'km', long: 'Kilometers' }
	};
	return short ? labels[unit].short : labels[unit].long;
}

export function getVolumeUnitLabel(unit: VolumeUnit, short = false): string {
	const labels: Record<VolumeUnit, { short: string; long: string }> = {
		gallons_us: { short: 'gal', long: 'Gallons (US)' },
		gallons_uk: { short: 'gal', long: 'Gallons (UK)' },
		liters: { short: 'L', long: 'Liters' }
	};
	return short ? labels[unit].short : labels[unit].long;
}

export function getChargeUnitLabel(unit: ChargeUnit, short = false): string {
	const labels: Record<ChargeUnit, { short: string; long: string }> = {
		kwh: { short: 'kWh', long: 'kWh' }
	};
	return short ? labels[unit].short : labels[unit].long;
}

export function getFuelEfficiencyLabel(distanceUnit: DistanceUnit, volumeUnit: VolumeUnit): string {
	const distLabel = getDistanceUnitLabel(distanceUnit, true);
	const volLabel = getVolumeUnitLabel(volumeUnit, true);
	return `${distLabel}/${volLabel}`;
}

export function getElectricEfficiencyLabel(
	distanceUnit: DistanceUnit,
	chargeUnit: ChargeUnit
): string {
	const distLabel = getDistanceUnitLabel(distanceUnit, true);
	const chargeLabel = getChargeUnitLabel(chargeUnit, true);
	return `${distLabel}/${chargeLabel}`;
}

export function getCostPerDistanceLabel(distanceUnit: DistanceUnit): string {
	return `Cost/${getDistanceUnitLabel(distanceUnit, true)}`;
}

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
