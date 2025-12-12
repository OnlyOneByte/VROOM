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

export interface VehicleFinancingPayment {
	id: string;
	financingId: string;
	paymentDate: string;
	paymentAmount: number;
	principalAmount: number;
	interestAmount: number;
	remainingBalance: number;
	paymentNumber: number;
	paymentType: 'standard' | 'extra' | 'custom-split';
	isScheduled: boolean;
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

/**
 * Expense type - Frontend representation
 *
 * IMPORTANT: Field name mappings with backend:
 * - Frontend `amount` ↔ Backend `expenseAmount`
 * - Frontend `volume` ↔ Backend `fuelAmount` (for gas/hybrid vehicles)
 * - Frontend `charge` ↔ Backend `fuelAmount` (for electric vehicles)
 *
 * The API transformation layer handles these mappings automatically.
 * See: frontend/src/lib/services/api-transformer.ts
 */
export interface Expense {
	id: string;
	vehicleId: string;
	tags: string[];
	category: ExpenseCategory;
	/** Total expense amount (maps to backend `expenseAmount`) */
	amount: number;
	date: string; // ISO date string
	mileage?: number;
	/** Fuel volume in gallons/liters (maps to backend `fuelAmount` for gas/hybrid) */
	volume?: number;
	/** Electric charge in kWh (maps to backend `fuelAmount` for electric) */
	charge?: number;
	fuelType?: string;
	description?: string;
	receiptUrl?: string;
	createdAt: string; // ISO date string
	updatedAt: string; // ISO date string
}

/**
 * Backend expense request format
 * Used internally by API transformation layer
 */
export interface BackendExpenseRequest {
	vehicleId: string;
	tags: string[];
	category: string;
	/** Backend field name for total expense amount */
	expenseAmount: number;
	date: string;
	mileage?: number;
	/** Backend unified field for both volume and charge */
	fuelAmount?: number;
	fuelType?: string;
	description?: string;
	receiptUrl?: string;
}

/**
 * Backend expense response format
 * Used internally by API transformation layer
 */
export interface BackendExpenseResponse {
	id: string;
	vehicleId: string;
	tags: string[];
	category: string;
	/** Backend field name for total expense amount */
	expenseAmount: number;
	date: string;
	mileage?: number;
	/** Backend unified field for both volume and charge */
	fuelAmount?: number;
	fuelType?: string;
	description?: string;
	receiptUrl?: string;
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

/**
 * Type guard: Check if an expense object uses backend field names
 */
export function hasBackendFieldNames(expense: Record<string, unknown>): boolean {
	return 'expenseAmount' in expense || 'fuelAmount' in expense;
}

/**
 * Type guard: Check if an expense object uses frontend field names
 */
export function hasFrontendFieldNames(expense: Record<string, unknown>): boolean {
	return 'amount' in expense || 'volume' in expense || 'charge' in expense;
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
	googleDriveBackupRetentionCount?: number;
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
