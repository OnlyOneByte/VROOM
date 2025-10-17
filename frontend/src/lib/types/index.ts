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
	vehicleType: 'gas' | 'electric' | 'hybrid';
	licensePlate?: string;
	nickname?: string;
	initialMileage?: number;
	purchasePrice?: number;
	purchaseDate?: string;
	createdAt: string;
	updatedAt: string;
	financing?: VehicleFinancing;
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
	startDate: string;
	paymentAmount: number;
	paymentFrequency: 'monthly' | 'bi-weekly' | 'weekly' | 'custom';
	paymentDayOfMonth?: number;
	paymentDayOfWeek?: number;
	// Lease-specific fields
	residualValue?: number;
	mileageLimit?: number;
	excessMileageFee?: number;
	// Status
	isActive: boolean;
	endDate?: string;
	createdAt: string;
	updatedAt: string;
}

export interface FinancingPaymentConfig {
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
	vehicleType: 'gas' | 'electric' | 'hybrid';
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
	tags: string[];
	category: ExpenseCategory;
	amount: number;
	date: string;
	mileage?: number;
	volume?: number; // For fuel
	charge?: number; // For electric
	description?: string;
	createdAt: string;
	updatedAt: string;
}

// ExpenseCategory is fetched from the backend API
// See /api/expenses/categories endpoint
export type ExpenseCategory = string;

export interface ExpenseCategoryInfo {
	value: string;
	label: string;
	description: string;
}

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

// Settings types
export interface UserSettings {
	id: string;
	userId: string;
	distanceUnit: 'miles' | 'kilometers';
	volumeUnit: 'gallons_us' | 'gallons_uk' | 'liters';
	chargeUnit: 'kwh';
	currencyUnit: string;
	autoBackupEnabled: boolean;
	backupFrequency: 'daily' | 'weekly' | 'monthly';
	lastBackupDate?: string;
	googleDriveBackupEnabled: boolean;
	googleDriveBackupFolderId?: string;
	googleSheetsSyncEnabled?: boolean;
	googleSheetsSpreadsheetId?: string;
	syncOnInactivity?: boolean;
	syncInactivityMinutes?: number;
	lastSyncDate?: string;
	createdAt: string;
	updatedAt: string;
}

export interface SettingsFormData {
	distanceUnit: 'miles' | 'kilometers';
	volumeUnit: 'gallons_us' | 'gallons_uk' | 'liters';
	chargeUnit: 'kwh';
	currencyUnit: string;
	autoBackupEnabled: boolean;
	backupFrequency: 'daily' | 'weekly' | 'monthly';
	googleDriveBackupEnabled: boolean;
	googleSheetsSyncEnabled?: boolean;
	syncOnInactivity?: boolean;
	syncInactivityMinutes?: number;
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
