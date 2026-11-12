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
}

const HIDDEN: MileageEfficiency = {
	calculatedMpg: null,
	calculatedEfficiency: null,
	showMpgCalculation: false
};

export function calculateMileageEfficiency(
	input: MileageEfficiencyInput
): MileageEfficiency | null {
	if (input.category !== 'fuel' || !input.mileage || !input.previousMileage) return null;

	const milesDriven = parseInt(input.mileage) - input.previousMileage;
	if (milesDriven <= 0) return HIDDEN;

	if (isElectricFuelType(input.fuelType) && input.charge) {
		return {
			calculatedMpg: null,
			calculatedEfficiency: round2(milesDriven / parseFloat(input.charge)),
			showMpgCalculation: true
		};
	}
	if (!isElectricFuelType(input.fuelType) && input.volume) {
		return {
			calculatedMpg: round2(milesDriven / parseFloat(input.volume)),
			calculatedEfficiency: null,
			showMpgCalculation: true
		};
	}
	return HIDDEN;
}

function round2(value: number): number {
	return Math.round(value * 100) / 100;
}
