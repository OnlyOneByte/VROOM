// User types
export interface User {
	id: string;
	email: string;
	displayName: string;
	provider: 'google';
	providerId: string;
	createdAt: string;
	updatedAt: string;
}

// Vehicle types
export interface Vehicle {
	id: string;
	make: string;
	model: string;
	year: number;
	licensePlate?: string;
	nickname?: string;
	initialMileage?: number;
	purchasePrice?: number;
	purchaseDate?: string;
	createdAt: string;
	updatedAt: string;
	loan?: VehicleLoan;
}

export interface VehicleLoan {
	lender: string;
	originalAmount: number;
	currentBalance: number;
	interestRate: number;
	monthlyPayment: number;
	startDate: string;
	endDate: string;
	isActive: boolean;
	apr?: number;
	termMonths?: number;
	standardPayment?: LoanPaymentConfig;
}

export interface LoanPaymentConfig {
	amount: number;
	frequency: 'monthly' | 'bi-weekly' | 'weekly' | 'custom';
	dayOfMonth?: number;
	dayOfWeek?: number;
}

// Form data types
export interface VehicleFormData {
	make: string;
	model: string;
	year: number;
	licensePlate?: string;
	nickname?: string;
	initialMileage?: number;
	purchasePrice?: number;
	purchaseDate?: string;
}

// Expense types
export interface Expense {
	id: string;
	vehicleId: string;
	type: ExpenseType;
	category: ExpenseCategory;
	amount: number;
	date: string;
	mileage?: number;
	gallons?: number;
	description?: string;
	createdAt: string;
	updatedAt: string;
}

export type ExpenseType =
	| 'fuel'
	| 'maintenance'
	| 'repairs'
	| 'insurance'
	| 'registration'
	| 'tolls'
	| 'parking'
	| 'other';

export type ExpenseCategory =
	| 'operating'
	| 'maintenance'
	| 'financial'
	| 'regulatory'
	| 'enhancement'
	| 'convenience';

// Notification types
export interface Notification {
	id: string;
	type: 'success' | 'error' | 'warning' | 'info';
	message: string;
	duration?: number;
	timestamp?: number;
}

// Store state types
export interface AuthState {
	user: User | null;
	isAuthenticated: boolean;
	isLoading: boolean;
	error: string | null;
	token: string | null;
}

export interface AppState {
	vehicles: Vehicle[];
	selectedVehicle: Vehicle | null;
	notifications: Notification[];
	isLoading: boolean;
	isMobileMenuOpen: boolean;
}

// Analytics types
export interface FuelEfficiencyData {
	averageMPG: number;
	trend: Array<{
		period: string;
		mpg: number;
		gallons: number;
		cost: number;
	}>;
	totalGallons: number;
	totalCost: number;
	efficiency: 'excellent' | 'good' | 'average' | 'poor';
}

export interface ExpenseAnalytics {
	totalExpenses: number;
	monthlyAverage: number;
	categoryBreakdown: Array<{
		category: string;
		amount: number;
		percentage: number;
	}>;
	trends: Array<{
		period: string;
		amount: number;
	}>;
}
