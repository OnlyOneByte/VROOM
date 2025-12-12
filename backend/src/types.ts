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

// Re-export types from db/types to avoid duplication
export type { AuthProvider, PaymentFrequency, PaymentType } from './db/types';

export enum Currency {
  USD = 'USD',
  EUR = 'EUR',
  GBP = 'GBP',
  CAD = 'CAD',
  AUD = 'AUD',
  JPY = 'JPY',
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

// Re-export type guards from db/types
export {
  isValidPaymentFrequency as isPaymentFrequency,
  isValidPaymentType as isPaymentType,
} from './db/types';

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

// Specific response interfaces removed - use ApiResponse<T> with domain types instead
// Example: ApiResponse<Vehicle>, ApiResponse<Expense[]>, etc.

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

// assertApiResponse removed - was never called
