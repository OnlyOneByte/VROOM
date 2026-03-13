/**
 * Shared Types - Re-exports from db/schema and db/types, plus application-specific types
 */

export type {
  Expense,
  InsurancePolicy,
  NewExpense,
  NewInsurancePolicy,
  NewPhotoRef,
  NewSession,
  NewUser,
  NewUserProvider,
  NewUserSettings,
  NewVehicle,
  NewVehicleFinancing,
  PhotoRef,
  Session,
  User,
  UserProvider,
  UserSettings,
  Vehicle,
  VehicleFinancing,
  VehicleWithFinancing,
} from './db/schema';

export type { ExpenseCategory, PaymentFrequency } from './db/types';
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

export interface UnitPreferences {
  distanceUnit: DistanceUnit;
  volumeUnit: VolumeUnit;
  chargeUnit: ChargeUnit;
}

export const DEFAULT_UNIT_PREFERENCES: UnitPreferences = {
  distanceUnit: DistanceUnit.MILES,
  volumeUnit: VolumeUnit.GALLONS_US,
  chargeUnit: ChargeUnit.KWH,
};

/**
 * Validates that a value is a valid UnitPreferences object with all required keys
 * containing valid enum members. Returns the validated object or null if invalid.
 */
export function parseUnitPreferences(value: unknown): UnitPreferences | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }

  const obj = value as Record<string, unknown>;

  if (typeof obj.distanceUnit !== 'string' || !isDistanceUnit(obj.distanceUnit)) {
    return null;
  }
  if (typeof obj.volumeUnit !== 'string' || !isVolumeUnit(obj.volumeUnit)) {
    return null;
  }
  if (typeof obj.chargeUnit !== 'string' || !isChargeUnit(obj.chargeUnit)) {
    return null;
  }

  return {
    distanceUnit: obj.distanceUnit,
    volumeUnit: obj.volumeUnit,
    chargeUnit: obj.chargeUnit,
  };
}

// Photo provider storage types

export type PhotoCategory =
  | 'vehicle_photos'
  | 'expense_receipts'
  | 'insurance_docs'
  | 'odometer_readings';

export interface CategorySetting {
  enabled: boolean;
  folderPath: string;
}

export interface StorageConfig {
  defaults: Record<PhotoCategory, string | null>;
  providerCategories: Record<string, Record<PhotoCategory, CategorySetting>>;
}

export const DEFAULT_STORAGE_CONFIG: StorageConfig = {
  defaults: {
    vehicle_photos: null,
    expense_receipts: null,
    insurance_docs: null,
    odometer_readings: null,
  },
  providerCategories: {},
};

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
  photos: import('./db/schema').Photo[];
  odometer: import('./db/schema').OdometerEntry[];
  photoRefs: import('./db/schema').PhotoRef[];
}

export interface ParsedBackupData {
  metadata: BackupMetadata;
  vehicles: Record<string, unknown>[];
  expenses: Record<string, unknown>[];
  financing: Record<string, unknown>[];
  insurance: Record<string, unknown>[];
  insurancePolicyVehicles: Record<string, unknown>[];
  photos: Record<string, unknown>[];
  odometer: Record<string, unknown>[];
  photoRefs: Record<string, unknown>[];
}

// Backup provider types

export interface ProviderBackupSettings {
  enabled: boolean;
  folderPath: string; // e.g., "/Backups" — appended to provider's rootPath
  retentionCount: number; // Max backups to keep (default 10)
  lastBackupAt?: string; // ISO 8601 — updated per-provider on successful backup
  sheetsSyncEnabled?: boolean; // Google Sheets sync toggle (only for google-drive providers)
  sheetsSpreadsheetId?: string; // The synced spreadsheet ID (only for google-drive providers)
}

export interface BackupConfig {
  providers: Record<string, ProviderBackupSettings>; // keyed by providerId
}

export const DEFAULT_BACKUP_CONFIG: BackupConfig = {
  providers: {},
};

export interface BackupFileInfo {
  providerId: string;
  providerName: string;
  providerType: string;
  fileRef: string; // Provider-specific reference (Drive fileId or S3 key)
  fileName: string;
  size: number;
  createdTime: string;
  isLatest: boolean;
}

export interface ProviderBackupList {
  providerId: string;
  providerName: string;
  providerType: string;
  backups: BackupFileInfo[];
  error?: string; // If listing failed for this provider
}
