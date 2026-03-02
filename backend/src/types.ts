/**
 * Shared Types - Re-exports from db/schema and db/types, plus application-specific types
 */

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
  Session,
  User,
  UserSettings,
  Vehicle,
  VehicleFinancing,
  VehicleWithFinancing,
} from './db/schema';

export type { AuthProvider, ExpenseCategory, PaymentFrequency } from './db/types';
export {
  EXPENSE_CATEGORIES,
  EXPENSE_CATEGORY_DESCRIPTIONS,
  EXPENSE_CATEGORY_LABELS,
  isValidPaymentFrequency as isPaymentFrequency,
} from './db/types';

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

export const isCurrency = (value: string): value is Currency =>
  Object.values(Currency).includes(value as Currency);
export const isDistanceUnit = (value: string): value is DistanceUnit =>
  Object.values(DistanceUnit).includes(value as DistanceUnit);
export const isVolumeUnit = (value: string): value is VolumeUnit =>
  Object.values(VolumeUnit).includes(value as VolumeUnit);
export const isChargeUnit = (value: string): value is ChargeUnit =>
  Object.values(ChargeUnit).includes(value as ChargeUnit);
export const isVehicleType = (value: string): value is VehicleType =>
  Object.values(VehicleType).includes(value as VehicleType);

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

export interface BackupMetadata {
  version: string;
  timestamp: string;
  userId: string;
}

export interface BackupData {
  metadata: BackupMetadata;
  vehicles: import('./db/schema').Vehicle[];
  expenses: import('./db/schema').Expense[];
  financing: import('./db/schema').VehicleFinancing[];
  insurance: import('./db/schema').InsurancePolicy[];
  insurancePolicyVehicles: import('./db/schema').InsurancePolicyVehicle[];
}

export interface ParsedBackupData {
  metadata: BackupMetadata;
  vehicles: Record<string, unknown>[];
  expenses: Record<string, unknown>[];
  financing: Record<string, unknown>[];
  insurance: Record<string, unknown>[];
  insurancePolicyVehicles: Record<string, unknown>[];
}
