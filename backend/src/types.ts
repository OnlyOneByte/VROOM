export type {
  Expense,
  InsurancePolicy,
  InsuranceTerm,
  InsuranceTermVehicle,
  NewExpense,
  NewPhotoRef,
  NewReminder,
  NewReminderNotification,
  NewReminderVehicle,
  NewUserPreferences,
  NewVehicle,
  NewVehicleFinancing,
  PhotoRef,
  Reminder,
  ReminderNotification,
  ReminderVehicle,
  Session,
  SyncState,
  User,
  UserPreferences,
  UserProvider,
  Vehicle,
  VehicleFinancing,
  VehicleWithFinancing,
} from './db/schema';

export type { ExpenseCategory, PaymentFrequency } from './db/types';
export {
  EXPENSE_CATEGORIES,
  EXPENSE_CATEGORY_DESCRIPTIONS,
  EXPENSE_CATEGORY_LABELS,
} from './db/types';

export type Environment = 'development' | 'production' | 'test';

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

export const isDistanceUnit = (value: string): value is DistanceUnit =>
  Object.values(DistanceUnit).includes(value as DistanceUnit);
export const isVolumeUnit = (value: string): value is VolumeUnit =>
  Object.values(VolumeUnit).includes(value as VolumeUnit);
export const isChargeUnit = (value: string): value is ChargeUnit =>
  Object.values(ChargeUnit).includes(value as ChargeUnit);

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

export const PHOTO_CATEGORIES = [
  'vehicle_photos',
  'expense_receipts',
  'insurance_docs',
  'odometer_readings',
] as const;

export type PhotoCategory = (typeof PHOTO_CATEGORIES)[number];

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
  insuranceTerms: import('./db/schema').InsuranceTerm[];
  insuranceTermVehicles: import('./db/schema').InsuranceTermVehicle[];
  insuranceClaims?: import('./db/schema').InsuranceClaim[];
  photos: import('./db/schema').Photo[];
  odometer: import('./db/schema').OdometerEntry[];
  photoRefs: import('./db/schema').PhotoRef[];
  userPreferences: import('./db/schema').UserPreferences[];
  syncState: import('./db/schema').SyncState[];
  reminders?: import('./db/schema').Reminder[];
  reminderVehicles?: import('./db/schema').ReminderVehicle[];
  reminderNotifications?: import('./db/schema').ReminderNotification[];
  trips?: import('./db/schema').Trip[];
  vehicleShares?: import('./db/schema').VehicleShare[];
}

export interface ParsedBackupData {
  metadata: BackupMetadata;
  vehicles: Record<string, unknown>[];
  expenses: Record<string, unknown>[];
  financing: Record<string, unknown>[];
  insurance: Record<string, unknown>[];
  insuranceTerms: Record<string, unknown>[];
  insuranceTermVehicles: Record<string, unknown>[];
  insuranceClaims?: Record<string, unknown>[];
  photos: Record<string, unknown>[];
  odometer: Record<string, unknown>[];
  photoRefs: Record<string, unknown>[];
  userPreferences: Record<string, unknown>[];
  syncState: Record<string, unknown>[];
  reminders?: Record<string, unknown>[];
  reminderVehicles?: Record<string, unknown>[];
  reminderNotifications?: Record<string, unknown>[];
  trips?: Record<string, unknown>[];
  vehicleShares?: Record<string, unknown>[];
}

export interface ProviderBackupSettings {
  enabled: boolean;
  folderPath: string;
  retentionCount: number;
  lastBackupAt?: string;
  sheetsSyncEnabled?: boolean;
  sheetsSpreadsheetId?: string;
}

export interface BackupConfig {
  providers: Record<string, ProviderBackupSettings>;
}

export const DEFAULT_BACKUP_CONFIG: BackupConfig = {
  providers: {},
};

export interface BackupFileInfo {
  providerId: string;
  providerName: string;
  providerType: string;
  fileRef: string;
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
  error?: string;
}
