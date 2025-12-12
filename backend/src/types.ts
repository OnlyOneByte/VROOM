/**
 * Consolidated Types Module
 *
 * This file consolidates all type definitions from:
 * - src/types/* (api.ts, api-responses.ts, enums.ts, index.ts)
 * - lib/types/* (analytics.ts, api-response.ts, database.ts, sync.ts)
 * - lib/services/analytics/types.ts
 * - lib/services/sync/types.ts
 *
 * Single source of truth for all shared types.
 */

// ============================================================================
// DATABASE ENTITY TYPES (Re-exported from db/schema)
// ============================================================================

import type {
  Expense as DbExpense,
  InsurancePolicy as DbInsurancePolicy,
  Vehicle as DbVehicle,
  VehicleFinancing as DbVehicleFinancing,
  VehicleFinancingPayment as DbVehicleFinancingPayment,
} from './db/schema';

export type {
  Expense,
  InsurancePolicy,
  NewExpense,
  NewInsurancePolicy,
  NewSession,
  NewUser,
  NewUserSettings,
  NewVehicle,
  NewVehicleFinancing,
  NewVehicleFinancingPayment,
  Session,
  User,
  UserSettings,
  Vehicle,
  VehicleFinancing,
  VehicleFinancingPayment,
  VehicleWithFinancing,
} from './db/schema';

// Re-export expense category types and constants from db/types
export type { ExpenseCategory } from './db/types';
export {
  EXPENSE_CATEGORIES,
  EXPENSE_CATEGORY_DESCRIPTIONS,
  EXPENSE_CATEGORY_LABELS,
} from './db/types';

// ============================================================================
// ENUMS
// ============================================================================

export enum PaymentFrequency {
  MONTHLY = 'monthly',
  BI_WEEKLY = 'bi-weekly',
  WEEKLY = 'weekly',
  CUSTOM = 'custom',
}

export enum PaymentType {
  STANDARD = 'standard',
  EXTRA = 'extra',
  CUSTOM_SPLIT = 'custom-split',
}

export enum Currency {
  USD = 'USD',
  EUR = 'EUR',
  GBP = 'GBP',
  CAD = 'CAD',
  AUD = 'AUD',
  JPY = 'JPY',
}

export enum AuthProvider {
  GOOGLE = 'google',
}

export enum Environment {
  DEVELOPMENT = 'development',
  PRODUCTION = 'production',
  TEST = 'test',
}

export enum DistanceUnit {
  MILES = 'miles',
  KILOMETERS = 'kilometers',
}

export enum VolumeUnit {
  GALLONS_US = 'gallons_us',
  GALLONS_UK = 'gallons_uk',
  LITERS = 'liters',
}

export enum ChargeUnit {
  KWH = 'kwh',
}

export enum VehicleType {
  GAS = 'gas',
  ELECTRIC = 'electric',
  HYBRID = 'hybrid',
}

// ============================================================================
// ENUM TYPE GUARDS
// ============================================================================

export const isPaymentFrequency = (value: string): value is PaymentFrequency => {
  return Object.values(PaymentFrequency).includes(value as PaymentFrequency);
};

export const isCurrency = (value: string): value is Currency => {
  return Object.values(Currency).includes(value as Currency);
};

export const isDistanceUnit = (value: string): value is DistanceUnit => {
  return Object.values(DistanceUnit).includes(value as DistanceUnit);
};

export const isVolumeUnit = (value: string): value is VolumeUnit => {
  return Object.values(VolumeUnit).includes(value as VolumeUnit);
};

export const isChargeUnit = (value: string): value is ChargeUnit => {
  return Object.values(ChargeUnit).includes(value as ChargeUnit);
};

export const isVehicleType = (value: string): value is VehicleType => {
  return Object.values(VehicleType).includes(value as VehicleType);
};

// ============================================================================
// API RESPONSE TYPES
// ============================================================================

export interface ApiError {
  code: string;
  message: string;
  details?: unknown;
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  message?: string;
  error?: string | ApiError;
  count?: number;
}

export interface AuthResponse {
  user: {
    id: string;
    email: string;
    displayName: string;
  };
  session: {
    id: string;
  };
}

export interface LogoutResponse {
  message: string;
}

export interface ExpenseResponse {
  id: string;
  tags: string[];
  category: string;
  amount: number;
  vehicleId: string;
  description?: string;
  date: Date;
  mileage?: number;
  volume?: number;
  charge?: number;
}

export interface VehicleResponse {
  id: string;
  make: string;
  model: string;
  year: number;
  licensePlate?: string;
  nickname?: string;
  initialMileage?: number;
  purchasePrice?: number;
  purchaseDate?: string;
  userId: string;
  createdAt: string;
  updatedAt: string;
}

export interface InsuranceResponse {
  id: string;
  company: string;
  policyNumber?: string;
  totalCost: number;
  monthlyCost: number;
  startDate: Date;
  endDate: Date;
  vehicleId: string;
  termLengthMonths: number;
  isActive: boolean;
}

export interface InsurancePolicyResponse {
  id: string;
  company: string;
  policyNumber: string;
  totalCost: number;
  termLengthMonths: number;
  startDate: string;
  endDate: string;
  monthlyCost: number;
  vehicleId: string;
  isActive: boolean;
  daysUntilExpiration?: number;
  expirationAlert?: {
    type: string;
    severity: string;
    message: string;
  };
}

export interface VehicleLoanResponse {
  id: string;
  vehicleId: string;
  financingType: string;
  provider: string;
  originalAmount: number;
  currentBalance: number;
  apr?: number;
  termMonths: number;
  startDate: string;
  paymentAmount: number;
  paymentFrequency: string;
  paymentDayOfMonth?: number;
  paymentDayOfWeek?: number;
  residualValue?: number;
  mileageLimit?: number;
  excessMileageFee?: number;
  isActive: boolean;
  endDate?: string;
}

export interface LoanPaymentResponse {
  id: string;
  financingId: string;
  paymentAmount: number;
  paymentNumber: number;
  principalAmount: number;
  interestAmount: number;
  remainingBalance: number;
  paymentDate: string;
}

export interface LoanAnalysisResponse {
  monthlyPayment: number;
  totalInterest: number;
  totalPayments: number;
  payoffDate: string;
}

export interface LoanScheduleResponse {
  analysis: LoanAnalysisResponse;
  schedule: Array<{
    paymentNumber: number;
    paymentDate: string;
    paymentAmount: number;
    principalAmount: number;
    interestAmount: number;
    remainingBalance: number;
  }>;
}

export interface ExpenseListResponse {
  data: ExpenseResponse[];
  filters: {
    tags?: string[];
    category?: string;
    vehicleId?: string;
  };
}

export interface InsuranceBreakdownResponse {
  breakdown: Array<{
    cost: number;
    monthName: string;
    startDate: Date;
    endDate: Date;
  }>;
}

export interface ExpiringInsuranceResponse {
  data: Array<{
    id: string;
    company: string;
    daysUntilExpiration: number;
    expirationAlert: {
      type: string;
      severity: string;
      message: string;
    };
  }>;
  daysAhead: number;
}

export interface CostBreakdownResponse {
  policyId?: string;
  company?: string;
  totalCost?: number;
  monthlyCost?: number;
  categoryBreakdown?: {
    [category: string]: {
      cost: number;
      count: number;
    };
  };
  breakdown?: Array<{
    month?: number;
    monthName?: string;
    cost: number;
    startDate?: Date;
    endDate?: Date;
  }>;
}

export type ExpenseListApiResponse = Array<{
  id: string;
  tags: string[];
  category: string;
  amount: number;
  vehicleId: string;
  description?: string;
  date: string;
  mileage?: number;
  gallons?: number;
}>;

export interface ExpenseListApiResponseWithMeta extends ApiResponse<ExpenseListApiResponse> {
  count: number;
  filters: {
    tags?: string[];
    category?: string;
    startDate?: string;
    endDate?: string;
  };
}

export interface ExpenseCategoryInfo {
  value: string;
  label: string;
  description: string;
}

export type ExpenseCategoriesApiResponse = ExpenseCategoryInfo[];

export interface FuelEfficiencyApiResponse {
  vehicleId: string;
  totalFuelExpenses: number;
  averageMPG: number;
  totalGallons: number;
  totalMiles: number;
  averageCostPerGallon: number;
  averageCostPerMile: number;
  efficiencyTrend: Array<{
    date: Date;
    mpg: number;
    cost: number;
    mileage?: number;
    gallons?: number;
    costPerGallon?: number;
  }>;
  alerts: Array<{
    type: string;
    message: string;
    severity: string;
    date: Date;
    currentMPG?: number;
    averageMPG?: number;
  }>;
}

export interface CostPerMileApiResponse {
  totalCostPerMile: number;
  categoryBreakdown: {
    [category: string]: {
      cost: number;
      costPerMile: number;
    };
  };
  monthlyTrends: Array<{
    month: string;
    cost: number;
    estimatedMiles: number;
    costPerMile: number;
  }>;
  currentMileage: number;
  totalMiles: number;
  totalCost: number;
}

export interface ExpiringPoliciesResponse {
  data: InsurancePolicyResponse[];
  daysAhead: number;
}

// ============================================================================
// ANALYTICS TYPES
// ============================================================================

export type AnalyticsQuery = {
  startDate?: Date;
  endDate?: Date;
  groupBy: 'day' | 'week' | 'month' | 'year';
};

export type DashboardAnalytics = {
  vehicles: Array<{ id: string; name: string; nickname?: string | null }>;
  totalExpenses: number;
  monthlyExpensesTrends: Array<{ period: string; amount: number }>;
  categoryBreakdown: {
    [key: string]: { amount: number; count: number; percentage: number };
  };
  fuelEfficiency: {
    averageMPG: number;
    totalVolume: number;
    totalFuelCost: number;
    averageCostPerGallon: number;
  };
  costPerMile: {
    totalCostPerMile: number;
    totalCost: number;
    totalMiles: number;
  };
};

export type VehicleAnalytics = {
  vehicle: { id: string; name: string; nickname?: string | null };
  totalExpenses: number;
  monthlyTrends: Array<{ period: string; amount: number }>;
  categoryBreakdown: {
    [key: string]: { amount: number; count: number; percentage: number };
  };
  fuelEfficiency: {
    averageMPG: number;
    totalVolume: number;
    totalMiles: number;
    trend: Array<{ date: Date; mpg: number; mileage?: number }>;
  };
  costPerMile: {
    costPerMile: number;
    totalCost: number;
    totalMiles: number;
  };
};

export type TrendData = {
  costTrends: Array<{ period: string; amount: number }>;
  milesTrends: Array<{ period: string; miles: number }>;
  costPerMileTrends: Array<{ period: string; costPerMile: number }>;
};

// ============================================================================
// SYNC AND BACKUP TYPES
// ============================================================================

export interface BackupMetadata {
  version: string;
  timestamp: string;
  userId: string;
}

export interface BackupData {
  metadata: BackupMetadata;
  vehicles: DbVehicle[];
  expenses: DbExpense[];
  financing: DbVehicleFinancing[];
  financingPayments: DbVehicleFinancingPayment[];
  insurance: DbInsurancePolicy[];
}

export interface ParsedBackupData {
  metadata: BackupMetadata;
  vehicles: Record<string, unknown>[];
  expenses: Record<string, unknown>[];
  financing: Record<string, unknown>[];
  financingPayments: Record<string, unknown>[];
  insurance: Record<string, unknown>[];
}

// ============================================================================
// DOMAIN MODEL TYPES
// ============================================================================

export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
}

export interface LoanPaymentConfig {
  amount: number;
  frequency: 'monthly' | 'bi-weekly' | 'weekly' | 'custom';
  dayOfMonth?: number; // For monthly (1-31)
  dayOfWeek?: number; // For weekly (0-6, Sunday=0)
  customSchedule?: {
    amount: number;
    dayOfMonth: number;
  }[]; // For future: multiple payments per month
}

export interface LoanAnalysis {
  loanId: string;
  currentScenario: LoanScenario;
  alternativeScenarios: LoanScenario[];
}

export interface LoanScenario {
  name: string; // "Current", "Pay Extra $100/month", "Bi-weekly payments"
  paymentConfig: LoanPaymentConfig;
  projectedPayoffDate: Date;
  totalInterestPaid: number;
  interestSavings: number; // Compared to standard
  monthsSaved: number;
  schedule: LoanPayment[];
}

export interface LoanPayment {
  id: string;
  loanId: string; // References VehicleLoan.id
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

export interface StorageConfig {
  sqlite: {
    path: string;
    backupEnabled: boolean;
  };
  googleDrive: {
    enabled: boolean;
    folderId?: string; // VROOM folder ID in Google Drive
    spreadsheetId?: string; // Main data spreadsheet ID
    autoSync: boolean;
    syncInterval: 'manual' | 'daily' | 'weekly' | 'on-inactivity';
    inactivityDelay: number; // Minutes of inactivity before auto-sync (default: 5)
    organizeByDate: boolean; // Auto-organize receipts by date
  };
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Helper function to assert API response types
 */
export function assertApiResponse<T>(data: unknown): asserts data is ApiResponse<T> {
  if (typeof data !== 'object' || data === null) {
    throw new Error('Response is not an object');
  }

  const response = data as Record<string, unknown>;
  if (typeof response.success !== 'boolean') {
    throw new Error('Response missing success field');
  }
}
