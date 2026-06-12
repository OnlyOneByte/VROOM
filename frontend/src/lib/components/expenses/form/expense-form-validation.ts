import { getVolumeUnitLabel, getChargeUnitLabel, isElectricFuelType } from '$lib/utils/units';
import { toDateInputValue } from '$lib/utils/formatters';
import type { Vehicle, VolumeUnit, ChargeUnit } from '$lib/types';

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
			if (amount > 999999) return 'Amount seems too large';
			break;
		}
		case 'date': {
			if (!value) return 'Date is required';
			// Compare CALENDAR DAYS, not Date instants. `new Date('YYYY-MM-DD')` parses as UTC
			// midnight, so for a user at a positive UTC offset it lands on tomorrow-morning-local
			// and a Date-instant `> new Date()` wrongly rejects TODAY as "in the future" (the
			// C6/C61 local-vs-UTC class). The date-picker value is already a local 'YYYY-MM-DD';
			// today's local day uses the same getFullYear/getMonth/getDate parts idiom this file
			// uses for mileage ordering (lines 96/109). String compare is timezone-safe.
			const now = new Date();
			const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
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
	if (ctx.category !== 'fuel') return null;

	const mileage = parseInt(value);
	if (!value || mileage <= 0) return 'Mileage required for fuel expenses';

	if (ctx.vehicle?.initialMileage && mileage < ctx.vehicle.initialMileage) {
		return 'Mileage cannot be less than initial mileage';
	}

	const currentDateStr: string =
		(ctx.formData['date'] as string) || toDateInputValue(new Date());
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
