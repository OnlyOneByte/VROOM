import type { VehicleType } from './vehicle.js';
import type { Expense, ExpenseCategory } from './expense.js';

export interface VehicleFormData {
	make: string;
	model: string;
	year: number;
	vehicleType: VehicleType;
	licensePlate?: string;
	nickname?: string;
	vin?: string;
	initialMileage?: number | undefined;
	purchasePrice?: number | undefined;
	purchaseDate?: string | undefined;
}

export interface ExpenseFormData {
	vehicleId: string;
	tags: string[];
	category: ExpenseCategory;
	amount: number;
	date: string;
	mileage?: number | undefined;
	volume?: number | undefined;
	charge?: number | undefined;
	fuelType?: string;
	description?: string;
	missedFillup?: boolean;
}

export interface ExpenseFilters {
	vehicleId?: string;
	category?: ExpenseCategory | undefined;
	tags?: string[];
	startDate?: string | undefined;
	endDate?: string | undefined;
	searchTerm?: string;
}

export interface VehicleFormErrors {
	make?: string;
	model?: string;
	year?: string;
	licensePlate?: string;
	nickname?: string;
	vin?: string;
	initialMileage?: string;
	purchasePrice?: string;
	purchaseDate?: string;
	[key: string]: string | undefined;
}

export interface FinancingFormErrors {
	financingType?: string;
	provider?: string;
	originalAmount?: string;
	apr?: string;
	termMonths?: string;
	startDate?: string;
	paymentAmount?: string;
	frequency?: string;
	dayOfMonth?: string;
	residualValue?: string;
	mileageLimit?: string;
	excessMileageFee?: string;
	[key: string]: string | undefined;
}

export interface ExpenseFormErrors {
	vehicleId?: string;
	tags?: string;
	category?: string;
	amount?: string;
	date?: string;
	mileage?: string;
	volume?: string;
	charge?: string;
	fuelType?: string;
	description?: string;
	[key: string]: string | undefined;
}

// DerivedPaymentEntry: computed from a financing Expense + VehicleFinancing config
export interface DerivedPaymentEntry {
	expense: Expense;
	paymentNumber: number;
	remainingBalance: number;
	principalAmount: number;
	interestAmount: number;
	paymentType: 'standard' | 'extra';
}

export interface FinancingPaymentConfig {
	amount: number;
	frequency: 'monthly' | 'bi-weekly' | 'weekly' | 'custom';
	dayOfMonth?: number;
	dayOfWeek?: number;
	customSchedule?: {
		amount: number;
		dayOfMonth: number;
	}[];
}
