import { getVolumeUnitLabel, getChargeUnitLabel, isElectricFuelType } from '#lib/utils/units.ts';
import { formatNumber, minorUnitScale, toDateInputValue } from '#lib/utils/formatters.ts';
import type { Vehicle, VolumeUnit, ChargeUnit } from '#lib/types/index.ts';
import { EXPENSE_LIMITS } from '#lib/constants/limits.ts';

const MINOR_UNIT_TOLERANCE = 1e-6;

function fitsMinorUnit(amount: number): boolean {
	const minor = amount * minorUnitScale();
	return Math.abs(minor - Math.round(minor)) < MINOR_UNIT_TOLERANCE;
}

export function hasMileageEntry(value: unknown): boolean {
	return value != null && value !== '';
}

interface ValidationContext {
	category: string;
	vehicle: Vehicle | null;
	volumeUnit: VolumeUnit;
	chargeUnit: ChargeUnit;
	allVehicleExpenses: Array<{ id: string; date: string; mileage?: number }>;
	expenseId?: string;
	formData: Record<string, string | string[]>;
}

export function validateExpenseField(field: string, ctx: ValidationContext): string | null {
	if (field === 'tags') return null;

	const value = ctx.formData[field];

	switch (field) {
		case 'vehicleId':
			if (!value) return 'Please select a vehicle';
			break;

		case 'category':
			if (!value) return 'Please select a category';
			break;

		case 'amount': {
			const amount = parseFloat(value as string);
			if (!value || amount <= 0) return 'Amount must be greater than 0';
			if (amount > EXPENSE_LIMITS.MAX_AMOUNT) {
				return `Amount must be ${formatNumber(EXPENSE_LIMITS.MAX_AMOUNT, 0)} or less`;
			}
			if (!fitsMinorUnit(amount)) {
				return `Amount can have at most ${Math.log10(minorUnitScale())} decimal places`;
			}
			break;
		}
		case 'date': {
			if (!value) return 'Date is required';
			// new Date('YYYY-MM-DD') parses as UTC, so compare calendar-day strings instead.
			const todayStr = toDateInputValue(new Date());
			if ((value as string) > todayStr) return 'Date cannot be in the future';
			break;
		}
		case 'volume': {
			if (
				ctx.category === 'fuel' &&
				!isElectricFuelType((ctx.formData['fuelType'] as string) || null)
			) {
				const volume = parseFloat(value as string);
				const unitLabel = getVolumeUnitLabel(ctx.volumeUnit);
				if (!value || volume <= 0) return `${unitLabel} required for fuel expenses`;
				if (volume > 1000) return `${unitLabel} seems too large`;
			}
			break;
		}
		case 'charge': {
			if (
				ctx.category === 'fuel' &&
				isElectricFuelType((ctx.formData['fuelType'] as string) || null)
			) {
				const charge = parseFloat(value as string);
				const unitLabel = getChargeUnitLabel(ctx.chargeUnit);
				if (!value || charge <= 0) return `${unitLabel} required for charging expenses`;
				if (charge > 1000) return `${unitLabel} seems too large`;
			}
			break;
		}
		case 'mileage':
			return validateMileage(value as string, ctx);

		case 'fuelType': {
			if (value && (value as string).length > 50) {
				return 'Fuel type must be 50 characters or less';
			}
			break;
		}
	}
	return null;
}

function validateMileage(value: string, ctx: ValidationContext): string | null {
	if (!hasMileageEntry(value) && ctx.category !== 'fuel') return null;

	const mileage = parseInt(value);
	if (!hasMileageEntry(value) || mileage <= 0) {
		return ctx.category === 'fuel'
			? 'Mileage required for fuel expenses'
			: 'Mileage must be greater than 0';
	}

	if (ctx.vehicle?.initialMileage && mileage < ctx.vehicle.initialMileage) {
		return 'Mileage cannot be less than initial mileage';
	}

	const currentDateStr: string = (ctx.formData['date'] as string) || toDateInputValue(new Date());
	const otherExpenses = ctx.allVehicleExpenses.filter(
		exp => exp.id !== ctx.expenseId && exp.mileage != null
	);

	const entriesBefore = otherExpenses.filter(exp => {
		return toDateInputValue(new Date(exp.date)) < currentDateStr;
	});

	if (entriesBefore.length > 0) {
		const maxBefore = Math.max(...entriesBefore.map(e => e.mileage!));
		if (mileage <= maxBefore) {
			return `Mileage must be greater than ${formatNumber(maxBefore, 0)} (from earlier entry)`;
		}
	}

	const entriesAfter = otherExpenses.filter(exp => {
		return toDateInputValue(new Date(exp.date)) > currentDateStr;
	});

	if (entriesAfter.length > 0) {
		const minAfter = Math.min(...entriesAfter.map(e => e.mileage!));
		if (mileage >= minAfter) {
			return `Mileage must be less than ${formatNumber(minAfter, 0)} (from later entry)`;
		}
	}

	return null;
}
