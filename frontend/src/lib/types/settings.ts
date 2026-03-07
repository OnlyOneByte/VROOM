export type VolumeUnit = 'gallons_us' | 'gallons_uk' | 'liters';
export type ChargeUnit = 'kwh';
export type DistanceUnit = 'miles' | 'kilometers';

export interface UnitPreferences {
	distanceUnit: DistanceUnit;
	volumeUnit: VolumeUnit;
	chargeUnit: ChargeUnit;
}

export type UnitsMetadata = UnitPreferences;

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
	storageConfig?: StorageConfig;
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
