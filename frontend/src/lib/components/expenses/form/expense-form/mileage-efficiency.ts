import type { DistanceUnit, VolumeUnit } from '#lib/types/index.ts';
import { isElectricFuelType } from '#lib/utils/units.ts';

export interface MileageEfficiency {
	calculatedMpg: number | null;
	calculatedEfficiency: number | null;
	showMpgCalculation: boolean;
}

export interface MileageEfficiencyInput {
	category: string;
	mileage: string;
	previousMileage: number | null | undefined;
	fuelType: string;
	volume: string;
	charge: string;
	distanceUnit: DistanceUnit;
	volumeUnit: VolumeUnit;
}

const HIDDEN: MileageEfficiency = {
	calculatedMpg: null,
	calculatedEfficiency: null,
	showMpgCalculation: false
};

const MIN_VALID_MPG = 5;
const MAX_VALID_MPG = 100;
const MIN_VALID_MI_KWH = 1;
const MAX_VALID_MI_KWH = 10;

const MILES_PER_UNIT: Record<DistanceUnit, number> = {
	miles: 1,
	kilometers: 1 / 1.609344
};

const US_GALLONS_PER_UNIT: Record<VolumeUnit, number> = {
	gallons_us: 1,
	gallons_uk: 4.54609 / 3.785411784,
	liters: 1 / 3.785411784
};

export function calculateMileageEfficiency(
	input: MileageEfficiencyInput
): MileageEfficiency | null {
	if (input.category !== 'fuel' || !input.mileage || !input.previousMileage) return null;

	const milesDriven = parseInt(input.mileage) - input.previousMileage;
	if (milesDriven <= 0) return HIDDEN;
	const canonicalMiles = milesDriven * MILES_PER_UNIT[input.distanceUnit];

	if (isElectricFuelType(input.fuelType) && input.charge) {
		const kwh = parseFloat(input.charge);
		if (!within(canonicalMiles / kwh, MIN_VALID_MI_KWH, MAX_VALID_MI_KWH)) return HIDDEN;
		return {
			calculatedMpg: null,
			calculatedEfficiency: round2(milesDriven / kwh),
			showMpgCalculation: true
		};
	}
	if (!isElectricFuelType(input.fuelType) && input.volume) {
		const volume = parseFloat(input.volume);
		const canonicalMpg = canonicalMiles / (volume * US_GALLONS_PER_UNIT[input.volumeUnit]);
		if (!within(canonicalMpg, MIN_VALID_MPG, MAX_VALID_MPG)) return HIDDEN;
		return {
			calculatedMpg: round2(milesDriven / volume),
			calculatedEfficiency: null,
			showMpgCalculation: true
		};
	}
	return HIDDEN;
}

function within(value: number, min: number, max: number): boolean {
	return value >= min && value <= max;
}

function round2(value: number): number {
	return Math.round(value * 100) / 100;
}
