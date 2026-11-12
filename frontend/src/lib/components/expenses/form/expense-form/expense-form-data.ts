import { toDateInputValue } from '#lib/utils/formatters.ts';

export interface ExpenseFormData {
	vehicleId: string;
	tags: string[];
	category: string;
	amount: string;
	date: string;
	mileage: string;
	volume: string;
	charge: string;
	fuelType: string;
	description: string;
	location: string;
	missedFillup: boolean;
}

export function createEmptyFormData(today: Date = new Date()): ExpenseFormData {
	return {
		vehicleId: '',
		tags: [],
		category: '',
		amount: '',
		date: toDateInputValue(today),
		mileage: '',
		volume: '',
		charge: '',
		fuelType: '',
		description: '',
		location: '',
		missedFillup: false
	};
}
