import {
	getVolumeUnitLabel,
	getChargeUnitLabel,
	usesLiquidFuel,
	usesElectricCharge
} from '$lib/utils/units';
import type { Vehicle, VolumeUnit, ChargeUnit } from '$lib/types';

interface ValidationContext {
	selectedCategoryLabel: string;
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
			if (amount > 999999) return 'Amount seems too large';
			break;
		}
		case 'date': {
			if (!value) return 'Date is required';
			const selectedDate = new Date(value as string);
			const today = new Date();
			if (selectedDate > today) return 'Date cannot be in the future';
			break;
		}
		case 'volume': {
			if (
				ctx.selectedCategoryLabel === 'Fuel' &&
				ctx.vehicle &&
				usesLiquidFuel(ctx.vehicle.vehicleType)
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
				ctx.selectedCategoryLabel === 'Fuel' &&
				ctx.vehicle &&
				usesElectricCharge(ctx.vehicle.vehicleType)
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
	if (ctx.selectedCategoryLabel !== 'Fuel') return null;

	const mileage = parseInt(value);
	if (!value || mileage <= 0) return 'Mileage required for fuel expenses';

	if (ctx.vehicle?.initialMileage && mileage < ctx.vehicle.initialMileage) {
		return 'Mileage cannot be less than initial mileage';
	}

	const currentDateStr: string =
		(ctx.formData['date'] as string) || new Date().toISOString().split('T')[0] || '';
	const otherExpenses = ctx.allVehicleExpenses.filter(
		exp => exp.id !== ctx.expenseId && exp.mileage != null
	);

	const entriesBefore = otherExpenses.filter(exp => {
		const d = new Date(exp.date);
		const s = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
		return s < currentDateStr;
	});

	if (entriesBefore.length > 0) {
		const maxBefore = Math.max(...entriesBefore.map(e => e.mileage!));
		if (mileage <= maxBefore) {
			return `Mileage must be greater than ${maxBefore.toLocaleString()} (from earlier entry)`;
		}
	}

	const entriesAfter = otherExpenses.filter(exp => {
		const d = new Date(exp.date);
		const s = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
		return s > currentDateStr;
	});

	if (entriesAfter.length > 0) {
		const minAfter = Math.min(...entriesAfter.map(e => e.mileage!));
		if (mileage >= minAfter) {
			return `Mileage must be less than ${minAfter.toLocaleString()} (from later entry)`;
		}
	}

	return null;
}
