// Shared types for VROOM Car Tracker Frontend
// These types mirror the backend types for consistency

export type VehicleType = 'gas' | 'electric' | 'hybrid';

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

export interface Vehicle {
	id: string;
	userId?: string;
	make: string;
	model: string;
	year: number;
	vehicleType: VehicleType;
	trackFuel: boolean;
	trackCharging: boolean;
	licensePlate?: string;
	nickname?: string;
	vin?: string;
	initialMileage?: number;
	purchasePrice?: number;
	purchaseDate?: string;
	financing?: VehicleFinancing;
	unitPreferences?: UnitPreferences;
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
// --- Expense splitting types ---

export type SplitConfig =
	| { method: 'even'; vehicleIds: string[] }
	| { method: 'absolute'; allocations: Array<{ vehicleId: string; amount: number }> }
	| { method: 'percentage'; allocations: Array<{ vehicleId: string; percentage: number }> };

export interface ExpenseGroup {
	id: string;
	userId: string;
	splitConfig: SplitConfig;
	category: string;
	tags?: string[];
	date: string;
	description?: string;
	totalAmount: number;
	insurancePolicyId?: string;
	insuranceTermId?: string;
	createdAt: string;
	updatedAt: string;
}

export interface ExpenseGroupWithChildren {
	group: ExpenseGroup;
	children: Expense[];
}

// The six expense categories used throughout the app.
export type ExpenseCategory =
	| 'fuel'
	| 'maintenance'
	| 'financial'
	| 'regulatory'
	| 'enhancement'
	| 'misc';

export interface ExpenseCategoryInfo {
	value: string;
	label: string;
	description: string;
}

export type VolumeUnit = 'gallons_us' | 'gallons_uk' | 'liters';
export type ChargeUnit = 'kwh';
export type DistanceUnit = 'miles' | 'kilometers';

export interface UnitPreferences {
	distanceUnit: DistanceUnit;
	volumeUnit: VolumeUnit;
	chargeUnit: ChargeUnit;
}

export type UnitsMetadata = UnitPreferences;

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
	missedFillup?: boolean; // true if user missed logging a previous fill-up
	expenseGroupId?: string; // FK to expense_groups — non-null means this is a split child
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

export interface TermVehicleCoverage {
	vehicleIds: string[];
	splitMethod?: 'even' | 'absolute' | 'percentage';
	allocations?: Array<{ vehicleId: string; amount?: number; percentage?: number }>;
}

export interface TermCoverageRow {
	termId: string;
	vehicleId: string;
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
	termVehicleCoverage: TermCoverageRow[];
	createdAt: string;
	updatedAt: string;
}

export interface CreatePolicyRequest {
	company: string;
	terms: {
		id: string;
		startDate: string;
		endDate: string;
		policyDetails?: PolicyDetails;
		financeDetails?: FinanceDetails;
		vehicleCoverage: TermVehicleCoverage;
	}[];
	notes?: string;
	isActive?: boolean;
}

export interface UpdatePolicyRequest {
	company?: string;
	notes?: string;
	isActive?: boolean;
}

export interface CreateTermRequest {
	id: string;
	startDate: string;
	endDate: string;
	policyDetails?: PolicyDetails;
	financeDetails?: FinanceDetails;
	vehicleCoverage: TermVehicleCoverage;
}

export interface UpdateTermRequest {
	startDate?: string;
	endDate?: string;
	policyDetails?: PolicyDetails;
	financeDetails?: FinanceDetails;
	vehicleCoverage?: TermVehicleCoverage;
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
	totalChargeCost: number;
	costPerMile: number | null;
	fuelExpenseCount: number;
	chargeExpenseCount: number;
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
	missedFillup?: boolean;
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
	unitPreferences: UnitPreferences;
	currencyUnit: string;
	autoBackupEnabled: boolean;
	backupFrequency: 'daily' | 'weekly' | 'monthly';
	lastBackupDate?: string;
	googleDriveBackupEnabled: boolean;
	googleDriveBackupFolderId?: string;
	googleDriveBackupRetentionCount?: number;
	googleDriveCustomFolderName?: string | null;
	googleSheetsSyncEnabled?: boolean;
	googleSheetsSpreadsheetId?: string;
	syncOnInactivity?: boolean;
	syncInactivityMinutes?: number;
	lastSyncDate?: string;
	createdAt: string;
	updatedAt: string;
}

export interface SettingsFormData {
	unitPreferences: UnitPreferences;
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

export interface OdometerEntry {
	id: string;
	vehicleId: string;
	odometer: number;
	recordedAt: string;
	note?: string;
	linkedEntityType?: string;
	linkedEntityId?: string;
	createdAt: string;
	updatedAt: string;
}

export interface PaginatedOdometerResponse {
	data: OdometerEntry[];
	totalCount: number;
	limit: number;
	offset: number;
	hasMore: boolean;
}

// --- Paginated response types ---

export interface PaginatedResponse<T> {
	data: T[];
	totalCount: number;
	limit: number;
	offset: number;
	hasMore: boolean;
}

// --- Expense summary types (mirrors backend ExpenseSummary) ---

export interface ExpenseSummary {
	totalAmount: number;
	expenseCount: number;
	monthlyAverage: number;
	recentAmount: number;
	categoryBreakdown: Array<{ category: string; amount: number; count: number }>;
	monthlyTrend: Array<{ period: string; amount: number; count: number }>;
}

// --- Analytics types (mirrors backend FuelEfficiencyPoint) ---

export interface FuelEfficiencyPoint {
	date: string;
	efficiency: number;
	mileage: number;
}

// --- Analytics Dashboard Response Types ---

export interface QuickStatsResponse {
	vehicleCount: number;
	ytdSpending: number;
	avgEfficiency: number | null;
	fleetHealthScore: number;
	units: UnitsMetadata;
}

export interface FuelStatsResponse {
	fillups: {
		currentYear: number;
		previousYear: number;
		currentMonth: number;
		previousMonth: number;
	};
	volume: {
		currentYear: number;
		previousYear: number;
		currentMonth: number;
		previousMonth: number;
	};
	fuelConsumption: {
		avgEfficiency: number | null;
		bestEfficiency: number | null;
		worstEfficiency: number | null;
	};
	fillupDetails: {
		avgVolume: number | null;
		minVolume: number | null;
		maxVolume: number | null;
	};
	averageCost: {
		perFillup: number | null;
		bestCostPerDistance: number | null;
		worstCostPerDistance: number | null;
		avgCostPerDay: number | null;
	};
	distance: {
		totalDistance: number;
		avgPerDay: number | null;
		avgPerMonth: number | null;
	};
	monthlyConsumption: Array<{ month: string; efficiency: number; volume: number }>;
	gasPriceHistory: Array<{ date: string; fuelType: string; pricePerVolume: number }>;
	fillupCostByVehicle: Array<{
		month: string;
		vehicleId: string;
		vehicleName: string;
		avgCost: number;
	}>;
	odometerProgression: Array<{
		month: string;
		vehicleId: string;
		vehicleName: string;
		mileage: number;
	}>;
	costPerDistance: Array<{
		month: string;
		vehicleId: string;
		vehicleName: string;
		costPerDistance: number;
	}>;
	units?: UnitsMetadata;
}

export interface FuelAdvancedResponse {
	maintenanceTimeline: Array<{
		service: string;
		lastServiceDate: string;
		nextDueDate: string;
		daysRemaining: number;
		status: 'good' | 'warning' | 'overdue';
	}>;
	seasonalEfficiency: Array<{
		season: string;
		avgEfficiency: number;
		fillupCount: number;
	}>;
	vehicleRadar: Array<{
		vehicleId: string;
		vehicleName: string;
		fuelEfficiency: number;
		maintenanceCost: number;
		reliability: number;
		annualCost: number;
		mileage: number;
	}>;
	dayOfWeekPatterns: Array<{
		day: string;
		fillupCount: number;
		avgCost: number;
		avgVolume: number;
	}>;
	monthlyCostHeatmap: Array<{
		month: string;
		fuel: number;
		maintenance: number;
		financial: number;
		regulatory: number;
		enhancement: number;
		misc: number;
	}>;
	fillupIntervals: Array<{
		intervalLabel: string;
		count: number;
	}>;
}

export interface AnalyticsSummaryResponse {
	quickStats: QuickStatsResponse;
	fuelStats: FuelStatsResponse;
	fuelAdvanced: FuelAdvancedResponse;
}

export interface CrossVehicleResponse {
	monthlyExpenseTrends: Array<{ month: string; amount: number }>;
	expenseByCategory: Array<{
		category: string;
		amount: number;
		percentage: number;
	}>;
	vehicleCostComparison: Array<{
		vehicleId: string;
		vehicleName: string;
		totalCost: number;
		costPerDistance: number | null;
	}>;
	fuelEfficiencyComparison: Array<{
		month: string;
		vehicles: Array<{ vehicleId: string; vehicleName: string; efficiency: number }>;
	}>;
	units?: UnitsMetadata;
}

export interface FinancingResponse {
	summary: {
		totalMonthlyPayments: number;
		remainingBalance: number;
		interestPaidYtd: number;
		activeCount: number;
		loanCount: number;
		leaseCount: number;
	};
	vehicleDetails: Array<{
		vehicleId: string;
		vehicleName: string;
		financingType: 'loan' | 'lease' | 'own';
		monthlyPayment: number;
		remainingBalance: number;
		apr: number | null;
		interestPaid: number;
		monthsRemaining: number;
	}>;
	monthlyTimeline: Array<{
		month: string;
		vehicles: Array<{ vehicleId: string; vehicleName: string; amount: number }>;
	}>;
	typeDistribution: Array<{
		type: string;
		value: number;
		count: number;
	}>;
	loanBreakdown: Array<{
		month: string;
		interest: number;
		principal: number;
	}>;
}

export interface InsuranceResponse {
	summary: {
		totalMonthlyPremiums: number;
		totalAnnualPremiums: number;
		activePoliciesCount: number;
	};
	vehicleDetails: Array<{
		vehicleId: string;
		vehicleName: string;
		carrier: string;
		monthlyPremium: number;
		annualPremium: number;
		deductible: number | null;
		coverageType: string | null;
	}>;
	monthlyPremiumTrend: Array<{ month: string; premiums: number }>;
	costByCarrier: Array<{ carrier: string; annualPremium: number; vehicleCount: number }>;
}

export interface VehicleHealthResponse {
	vehicleId: string;
	vehicleName: string;
	overallScore: number;
	maintenanceRegularity: number;
	mileageIntervalAdherence: number;
	insuranceCoverage: number;
}

export interface VehicleTCOResponse {
	vehicleId: string;
	vehicleName: string;
	purchasePrice: number | null;
	financingInterest: number;
	insuranceCost: number;
	fuelCost: number;
	maintenanceCost: number;
	otherCosts: number;
	totalCost: number;
	ownershipMonths: number;
	totalDistance: number;
	costPerDistance: number | null;
	costPerMonth: number;
	monthlyTrend: Array<{
		month: string;
		financing: number;
		insurance: number;
		fuel: number;
		maintenance: number;
	}>;
}

export interface VehicleExpensesResponse {
	maintenanceCosts: Array<{ month: string; cost: number }>;
	fuelEfficiencyAndCost: Array<{ month: string; efficiency: number | null; cost: number }>;
	expenseBreakdown: Array<{ category: string; amount: number }>;
}

export interface YearEndResponse {
	year: number;
	totalSpent: number;
	categoryBreakdown: Array<{
		category: string;
		amount: number;
		percentage: number;
	}>;
	efficiencyTrend: Array<{ month: string; efficiency: number }>;
	biggestExpense: {
		description: string;
		amount: number;
		date: string;
	} | null;
	previousYearComparison: {
		totalSpent: number;
		percentageChange: number;
	} | null;
	vehicleCount: number;
	totalDistance: number;
	avgEfficiency: number | null;
	costPerDistance: number | null;
	units?: UnitsMetadata;
}
