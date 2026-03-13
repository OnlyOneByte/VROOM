import { browser } from '$app/environment';
import type {
	UnitPreferences,
	UserSettings,
	BackupFileInfo,
	ProviderBackupList,
	RestoreProviderInfo,
	RestoreResult
} from '../types/index.js';
import { settingsApi } from '$lib/services/settings-api';

const DEFAULT_UNIT_PREFERENCES: UnitPreferences = {
	distanceUnit: 'miles',
	volumeUnit: 'gallons_us',
	chargeUnit: 'kwh'
};

function handleError(error: unknown): string {
	return error instanceof Error ? error.message : 'An unexpected error occurred';
}

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
				isLoading = false;
			} catch (err) {
				error = handleError(err);
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
				error = handleError(err);
				isLoading = false;
				throw err;
			}
		},

		async downloadBackup() {
			if (!browser) return;
			try {
				const response = await settingsApi.downloadBackup();
				if (!response.ok) throw new Error('Failed to download backup');

				const blob = await response.blob();
				const url = window.URL.createObjectURL(blob);
				const a = document.createElement('a');
				a.href = url;
				a.download = `vroom-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.zip`;
				document.body.appendChild(a);
				a.click();
				window.URL.revokeObjectURL(url);
				document.body.removeChild(a);
			} catch (err) {
				error = handleError(err);
				throw err;
			}
		},

		async uploadBackup(file: File, mode: 'preview' | 'replace' | 'merge' = 'preview') {
			try {
				const idempotencyKey = `restore-${mode}-${file.name}-${file.size}-${Date.now()}`;
				const result = await settingsApi.uploadBackup(file, mode, idempotencyKey);

				if (mode !== 'preview') {
					await this.load();
				}
				return result;
			} catch (err) {
				error = handleError(err);
				throw err;
			}
		},

		async executeSync(syncTypes: 'backup'[], force = false) {
			try {
				return await settingsApi.executeSync(syncTypes, force);
			} catch (err) {
				error = handleError(err);
				throw err;
			}
		},

		async listBackupsFromProvider(providerId: string): Promise<BackupFileInfo[]> {
			try {
				return await settingsApi.listBackupsFromProvider(providerId);
			} catch (err) {
				error = handleError(err);
				throw err;
			}
		},

		async listAllBackups(): Promise<ProviderBackupList[]> {
			try {
				return await settingsApi.listAllBackups();
			} catch (err) {
				error = handleError(err);
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
			try {
				const result = await settingsApi.restoreFromProvider(opts);
				if (opts.mode !== 'preview') {
					await this.load();
				}
				return result;
			} catch (err) {
				error = handleError(err);
				throw err;
			}
		},

		get restoreProviders() {
			return restoreProviders;
		},

		async loadRestoreProviders(): Promise<RestoreProviderInfo[]> {
			try {
				restoreProviders = await settingsApi.getRestoreProviders();
				return restoreProviders;
			} catch (err) {
				error = handleError(err);
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
