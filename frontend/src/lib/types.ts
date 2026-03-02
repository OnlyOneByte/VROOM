// Shared types for VROOM Car Tracker Frontend
// These types mirror the backend types for consistency

export interface User {
	id: string;
	email: string;
	displayName: string;
	provider: 'google';
	providerId: string;
	googleRefreshToken?: string;
	createdAt: string;
	updatedAt: string;
}

export type VehicleType = 'gas' | 'electric' | 'hybrid';

export interface Vehicle {
	id: string;
	userId?: string;
	make: string;
	model: string;
	year: number;
	vehicleType: VehicleType;
	licensePlate?: string;
	nickname?: string;
	vin?: string;
	initialMileage?: number;
	purchasePrice?: number;
	purchaseDate?: string;
	financing?: VehicleFinancing;
	createdAt: string;
	updatedAt: string;
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
	residualValue?: number;
	mileageLimit?: number;
	excessMileageFee?: number;
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
	customSchedule?: {
		amount: number;
		dayOfMonth: number;
	}[];
}

// DerivedPaymentEntry: computed from a financing Expense + VehicleFinancing config
export interface DerivedPaymentEntry {
	expense: Expense; // The underlying expense
	paymentNumber: number; // Derived from position in sorted list
	remainingBalance: number; // Derived: originalAmount - cumulative payments
	principalAmount: number; // From amortization schedule for this payment number
	interestAmount: number; // From amortization schedule for this payment number
	paymentType: 'standard' | 'extra'; // Inferred from amount vs scheduled payment
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
	currency?: string;
	date: string; // ISO date string
	mileage?: number;
	volume?: number; // For fuel expenses (gallons or liters)
	charge?: number; // For electric charging (kWh)
	fuelType?: string; // Octane rating or fuel type for fuel expenses
	description?: string;
	receiptUrl?: string;
	isFinancingPayment: boolean; // true if this expense is a financing payment
	createdAt: string; // ISO date string
	updatedAt: string; // ISO date string
}

// --- Insurance types ---

export interface PolicyDetails {
	policyNumber?: string;
	coverageDescription?: string;
	deductibleAmount?: number;
	coverageLimit?: number;
	agentName?: string;
	agentPhone?: string;
	agentEmail?: string;
}

export interface FinanceDetails {
	totalCost?: number;
	monthlyCost?: number;
	premiumFrequency?: string;
	paymentAmount?: number;
}

export interface PolicyTerm {
	id: string;
	startDate: string;
	endDate: string;
	policyDetails: PolicyDetails;
	financeDetails: FinanceDetails;
}

export interface InsurancePolicy {
	id: string;
	company: string;
	isActive: boolean;
	currentTermStart?: string;
	currentTermEnd?: string;
	terms: PolicyTerm[];
	notes?: string;
	vehicleIds: string[];
	createdAt: string;
	updatedAt: string;
}

export interface CreatePolicyRequest {
	company: string;
	vehicleIds: string[];
	terms: {
		id: string;
		startDate: string;
		endDate: string;
		policyDetails?: PolicyDetails;
		financeDetails?: FinanceDetails;
	}[];
	notes?: string;
	isActive?: boolean;
}

export interface UpdatePolicyRequest {
	company?: string;
	vehicleIds?: string[];
	notes?: string;
	isActive?: boolean;
}

export interface CreateTermRequest {
	id: string;
	startDate: string;
	endDate: string;
	policyDetails?: PolicyDetails;
	financeDetails?: FinanceDetails;
}

export interface UpdateTermRequest {
	startDate?: string;
	endDate?: string;
	policyDetails?: PolicyDetails;
	financeDetails?: FinanceDetails;
}

export interface FuelEfficiency {
	vehicleId: string;
	date: string;
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
	vin?: string;
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
	fuelType?: string; // Octane rating or fuel type for fuel expenses
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

// --- Store state types ---

export interface Notification {
	id: string;
	type: 'success' | 'error' | 'warning' | 'info';
	message: string;
	duration?: number;
	timestamp?: number;
}

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

// --- Settings types ---

export interface UserSettings {
	id: string;
	userId: string;
	distanceUnit: DistanceUnit;
	volumeUnit: VolumeUnit;
	chargeUnit: ChargeUnit;
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
	distanceUnit: DistanceUnit;
	volumeUnit: VolumeUnit;
	chargeUnit: ChargeUnit;
	currencyUnit: string;
	autoBackupEnabled: boolean;
	backupFrequency: 'daily' | 'weekly' | 'monthly';
	googleDriveBackupEnabled: boolean;
	googleSheetsSyncEnabled?: boolean;
	syncOnInactivity?: boolean;
	syncInactivityMinutes?: number;
}

// --- Backend API types (re-exported from api-transformer) ---
// Canonical definitions live in $lib/services/api-transformer.ts
export type { BackendExpenseRequest, BackendExpenseResponse } from './services/api-transformer.js';

// --- Analytics types ---

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

export interface Photo {
	id: string;
	entityType: string;
	entityId: string;
	driveFileId: string;
	fileName: string;
	mimeType: string;
	fileSize: number;
	webViewLink?: string;
	isCover: boolean;
	sortOrder: number;
	createdAt: string;
}
