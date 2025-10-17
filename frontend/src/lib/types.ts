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

export interface Vehicle {
	id: string;
	userId: string;
	make: string;
	model: string;
	year: number;
	licensePlate?: string;
	nickname?: string;
	initialMileage?: number;
	purchasePrice?: number;
	purchaseDate?: Date;
	loan?: VehicleLoan;
	createdAt: Date;
	updatedAt: Date;
}

export interface VehicleLoan {
	id: string;
	vehicleId: string;
	lender: string;
	originalAmount: number;
	currentBalance: number;
	apr: number;
	termMonths: number;
	startDate: Date;
	paymentAmount: number;
	paymentFrequency: 'monthly' | 'bi-weekly' | 'weekly';
	paymentDayOfMonth?: number;
	paymentDayOfWeek?: number;
	isActive: boolean;
	payoffDate?: Date;
	createdAt: Date;
	updatedAt: Date;
}

export interface LoanPaymentConfig {
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

export type ExpenseCategory =
	| 'fuel'
	| 'maintenance'
	| 'financial'
	| 'regulatory'
	| 'enhancement'
	| 'misc';

export interface Expense {
	id: string;
	vehicleId: string;
	tags: string[]; // Flexible tags
	category: ExpenseCategory;
	amount: number;
	currency: string;
	date: Date;
	mileage?: number;
	gallons?: number;
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

export interface LoanPayment {
	id: string;
	loanId: string;
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
	gallons?: number | undefined;
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

export interface LoanFormErrors {
	lender?: string;
	originalAmount?: string;
	apr?: string;
	termMonths?: string;
	startDate?: string;
	paymentAmount?: string;
	frequency?: string;
	dayOfMonth?: string;
	[key: string]: string | undefined;
}

export interface ExpenseFormErrors {
	vehicleId?: string;
	tags?: string;
	category?: string;
	amount?: string;
	date?: string;
	mileage?: string;
	gallons?: string;
	description?: string;
	[key: string]: string | undefined;
}
