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
	'vehicle_photos' | 'expense_receipts' | 'insurance_docs' | 'odometer_readings';

export interface CategorySetting {
	enabled: boolean;
	folderPath: string;
}

export interface StorageConfig {
	defaults: Record<PhotoCategory, string | null>;
	providerCategories: Record<string, Record<PhotoCategory, CategorySetting>>;
}

export interface ProviderBackupSettings {
	enabled: boolean;
	folderPath: string;
	retentionCount: number;
	lastBackupAt?: string;
	sheetsSyncEnabled?: boolean;
	sheetsSpreadsheetId?: string;
	sheetsAutoPausedAt?: string;
}

export interface BackupConfig {
	providers: Record<string, ProviderBackupSettings>;
}

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

export interface RestoreProviderInfo {
	providerId: string;
	providerType: string;
	displayName: string;
	accountEmail: string;
	sourceTypes: ('zip' | 'sheets')[];
}

export interface BackupOrchestratorResult {
	timestamp: string;
	status?: 'in_progress';
	skipped?: boolean;
	outcome: 'success' | 'partial' | 'failed' | 'noop';
	failedProviders: string[];
	results: Record<
		string,
		{
			success: boolean;
			message?: string;
			unusable?: boolean;
			capabilities: Record<
				string,
				{ success: boolean; message?: string; metadata?: Record<string, unknown> }
			>;
		}
	>;
}

export interface RestoreResult {
	success: boolean;
	preview?: Record<string, number>;
	imported?: Record<string, number>;
	skipped?: { photos: number };
	conflicts?: Array<{ table: string; id: string }>;
	grants?: {
		reapplied: number;
		dropped: Array<{
			kind: 'role' | 'override';
			vehicleId: string;
			userId: string;
			reason: string;
		}>;
	};
}

export interface UserSettings {
	id: string;
	userId: string;
	unitPreferences: UnitPreferences;
	currencyUnit: string;
	businessMileageRate?: number;
	themePreference?: string;
	autoBackupEnabled: boolean;
	backupFrequency: 'daily' | 'weekly' | 'monthly';
	lastBackupDate?: string;
	syncOnInactivity?: boolean;
	syncInactivityMinutes?: number;
	lastSyncDate?: string;
	storageConfig?: StorageConfig;
	backupConfig?: BackupConfig;
	providerDefaults?: Partial<Record<'ai.llm' | 'ai.vision', string | null>>;
	communityStatsOptIn?: boolean;
	communityStatsConsentedAt?: string | null;
	communityRegion?: string | null;
	communityStatsMode?: CommunityStatsMode;
	communityStatsMinGroup?: number;
	createdAt: string;
	updatedAt: string;
}

export type CommunityStatsMode = 'off' | 'local';

export type CommunityStatsUpdate = Partial<
	Pick<UserSettings, 'communityStatsOptIn' | 'communityRegion'>
>;
