import { browser } from '$app/env';
import type {
	UnitPreferences,
	UserSettings,
	BackupFileInfo,
	ProviderBackupList,
	RestoreProviderInfo,
	RestoreResult
} from '../types/index.js';
import { settingsApi } from '#lib/services/settings-api.ts';
import { themeStore } from '#lib/stores/theme.svelte.ts';
import { triggerBlobDownload } from '#lib/utils/download.ts';
import { extractErrorMessage } from '#lib/utils/error-handling.ts';

const DEFAULT_UNIT_PREFERENCES: UnitPreferences = {
	distanceUnit: 'miles',
	volumeUnit: 'gallons_us',
	chargeUnit: 'kwh'
};

const UNEXPECTED_ERROR = 'An unexpected error occurred';

function createSettingsStore() {
	let settings = $state<UserSettings | null>(null);
	let isLoading = $state(false);
	let error = $state<string | null>(null);
	let restoreProviders = $state<RestoreProviderInfo[]>([]);

	return {
		get settings() {
			return settings;
		},
		get unitPreferences() {
			return settings?.unitPreferences ?? DEFAULT_UNIT_PREFERENCES;
		},
		get isLoading() {
			return isLoading;
		},
		get error() {
			return error;
		},

		async load() {
			isLoading = true;
			error = null;
			try {
				settings = await settingsApi.getSettings();
				themeStore.reconcileServerTheme(settings.themePreference);
				isLoading = false;
			} catch (err) {
				error = extractErrorMessage(err, UNEXPECTED_ERROR);
				isLoading = false;
			}
		},

		async update(updates: Partial<UserSettings>) {
			isLoading = true;
			error = null;
			try {
				settings = await settingsApi.updateSettings(updates);
				isLoading = false;
				return settings;
			} catch (err) {
				error = extractErrorMessage(err, UNEXPECTED_ERROR);
				isLoading = false;
				throw err;
			}
		},

		async downloadBackup() {
			if (!browser) return;
			error = null;
			try {
				const response = await settingsApi.downloadBackup();
				const blob = await response.blob();
				triggerBlobDownload(
					blob,
					`vroom-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.zip`
				);
			} catch (err) {
				error = extractErrorMessage(err, UNEXPECTED_ERROR);
				throw err;
			}
		},

		async uploadBackup(file: File, mode: 'preview' | 'replace' | 'merge' = 'preview') {
			error = null;
			try {
				const idempotencyKey = `restore-${mode}-${file.name}-${file.size}-${Date.now()}`;
				const result = await settingsApi.uploadBackup(file, mode, idempotencyKey);

				if (mode !== 'preview') {
					await this.load();
				}
				return result;
			} catch (err) {
				error = extractErrorMessage(err, UNEXPECTED_ERROR);
				throw err;
			}
		},

		async executeSync(syncTypes: 'backup'[], force = false) {
			error = null;
			try {
				return await settingsApi.executeSync(syncTypes, force);
			} catch (err) {
				error = extractErrorMessage(err, UNEXPECTED_ERROR);
				throw err;
			}
		},

		async listBackupsFromProvider(providerId: string): Promise<BackupFileInfo[]> {
			error = null;
			try {
				return await settingsApi.listBackupsFromProvider(providerId);
			} catch (err) {
				error = extractErrorMessage(err, UNEXPECTED_ERROR);
				throw err;
			}
		},

		async listAllBackups(): Promise<ProviderBackupList[]> {
			error = null;
			try {
				return await settingsApi.listAllBackups();
			} catch (err) {
				error = extractErrorMessage(err, UNEXPECTED_ERROR);
				throw err;
			}
		},

		async restoreFromProvider(opts: {
			providerId: string;
			sourceType: 'zip' | 'sheets';
			mode: 'preview' | 'replace' | 'merge';
			fileRef?: string;
			idempotencyKey: string;
		}): Promise<RestoreResult> {
			error = null;
			try {
				const result = await settingsApi.restoreFromProvider(opts);
				if (opts.mode !== 'preview') {
					await this.load();
				}
				return result;
			} catch (err) {
				error = extractErrorMessage(err, UNEXPECTED_ERROR);
				throw err;
			}
		},

		get restoreProviders() {
			return restoreProviders;
		},

		async loadRestoreProviders(): Promise<RestoreProviderInfo[]> {
			error = null;
			try {
				restoreProviders = await settingsApi.getRestoreProviders();
				return restoreProviders;
			} catch (err) {
				error = extractErrorMessage(err, UNEXPECTED_ERROR);
				throw err;
			}
		},

		reset() {
			settings = null;
			isLoading = false;
			error = null;
			restoreProviders = [];
		}
	};
}

export const settingsStore = createSettingsStore();
