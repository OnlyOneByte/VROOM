// Shared types for VROOM Car Tracker Frontend
// These types mirror the backend types for consistency

export interface User {
	id: string;
	email: string;
	displayName: string;
	provider: 'google';
	providerId: string;
	googleRefreshToken?: string;
	createdAt: Date;
	updatedAt: Date;
}

export type VehicleType = 'gas' | 'electric' | 'hybrid';

export interface Vehicle {
	id: string;
	userId: string;
	make: string;
	model: string;
	year: number;
	vehicleType: VehicleType;
	licensePlate?: string;
	nickname?: string;
	initialMileage?: number;
	purchasePrice?: number;
	purchaseDate?: Date;
	financing?: VehicleFinancing;
	createdAt: Date;
	updatedAt: Date;
}

export interface VehicleFinancing {
	id: string;
	vehicleId: string;
	financingType: 'loan' | 'lease' | 'own';
	provider: string;
	originalAmount: number;
	currentBalance: number;
	apr?: number;
	termMonths: number;
	startDate: Date;
	paymentAmount: number;
	paymentFrequency: 'monthly' | 'bi-weekly' | 'weekly';
	paymentDayOfMonth?: number;
	paymentDayOfWeek?: number;
	// Lease-specific fields
	residualValue?: number;
	mileageLimit?: number;
	excessMileageFee?: number;
	// Status
	isActive: boolean;
	endDate?: Date;
	createdAt: Date;
	updatedAt: Date;
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

// Common tag suggestions (not enforced)
export const COMMON_EXPENSE_TAGS = [
	'fuel',
	'tolls',
	'parking',
	'maintenance',
	'repairs',
	'tires',
	'oil-change',
	'insurance',
	'loan-payment',
	'registration',
	'inspection',
	'emissions',
	'tickets',
	'modifications',
	'accessories',
	'detailing',
	'car-wash',
	'wax',
	'interior-cleaning',
	'emergency',
	'routine'
] as const;

// ExpenseCategory is fetched from the backend API
// See /api/expenses/categories endpoint
export type ExpenseCategory = string;

export interface ExpenseCategoryInfo {
	value: string;
	label: string;
	description: string;
}

export type VolumeUnit = 'gallons_us' | 'gallons_uk' | 'liters';
export type ChargeUnit = 'kwh';
export type DistanceUnit = 'miles' | 'kilometers';

export interface Expense {
	id: string;
	vehicleId: string;
	tags: string[]; // Flexible tags
	category: ExpenseCategory;
	amount: number;
	currency: string;
	date: Date;
	mileage?: number;
	volume?: number; // For fuel expenses (gallons or liters)
	charge?: number; // For electric charging (kWh)
	description?: string;
	receiptUrl?: string;
	createdAt: Date;
	updatedAt: Date;
}

export interface InsurancePolicy {
	id: string;
	vehicleId: string;
	company: string;
	policyNumber?: string;
	totalCost: number;
	termLengthMonths: number;
	startDate: Date;
	endDate: Date;
	monthlyCost: number;
	isActive: boolean;
	createdAt: Date;
	updatedAt: Date;
}

export interface FinancingPayment {
	id: string;
	financingId: string;
	paymentDate: Date;
	paymentAmount: number;
	principalAmount: number;
	interestAmount: number;
	remainingBalance: number;
	paymentNumber: number;
	paymentType: 'standard' | 'extra' | 'custom-split';
	isScheduled: boolean;
	createdAt: Date;
	updatedAt: Date;
}

export interface FuelEfficiency {
	vehicleId: string;
	date: Date;
	mpg: number;
	milesPerMonth: number;
	costPerMile: number;
	totalGallons: number;
}

export interface VehicleStats {
	period: '7d' | '30d' | '90d' | '1y' | 'all';
	totalMileage: number;
	currentMileage: number | null;
	totalFuelConsumed: number;
	totalChargeConsumed: number;
	averageMpg: number | null;
	averageMilesPerKwh: number | null;
	totalFuelCost: number;
	costPerMile: number | null;
	fuelExpenseCount: number;
}

// Frontend-specific types
export interface ApiResponse<T = unknown> {
	success: boolean;
	data?: T;
	error?: string;
	message?: string;
}

export interface AuthUser {
	id: string;
	email: string;
	displayName: string;
}

// Form validation types
export interface VehicleFormData {
	make: string;
	model: string;
	year: number;
	vehicleType: VehicleType;
	licensePlate?: string;
	nickname?: string;
	initialMileage?: number | undefined;
	purchasePrice?: number | undefined;
	purchaseDate?: string | undefined;
}

export interface ExpenseFormData {
	vehicleId: string;
	tags: string[]; // Flexible tags
	category: ExpenseCategory;
	amount: number;
	date: string;
	mileage?: number | undefined;
	volume?: number | undefined; // For fuel
	charge?: number | undefined; // For electric
	description?: string;
}

// Store types for Svelte stores - moved to types/index.ts

export interface ExpenseFilters {
	vehicleId?: string;
	category?: ExpenseCategory | undefined;
	tags?: string[]; // Filter by tags
	startDate?: string | undefined;
	endDate?: string | undefined;
	searchTerm?: string;
}

// Form validation error types
export interface VehicleFormErrors {
	make?: string;
	model?: string;
	year?: string;
	licensePlate?: string;
	nickname?: string;
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
	description?: string;
	[key: string]: string | undefined;
}
