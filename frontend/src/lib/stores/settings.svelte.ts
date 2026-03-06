import { browser } from '$app/environment';
import type { UnitPreferences, UserSettings } from '../types/index.js';
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

		async configureSyncSettings(config: {
			googleSheetsSyncEnabled?: boolean;
			googleDriveBackupEnabled?: boolean;
			syncInactivityMinutes?: number;
		}) {
			try {
				const result = await settingsApi.configureSyncSettings(config);
				await this.load();
				return result;
			} catch (err) {
				error = handleError(err);
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

		async executeSync(syncTypes: ('sheets' | 'backup')[], force = false) {
			try {
				return await settingsApi.executeSync(syncTypes, force);
			} catch (err) {
				error = handleError(err);
				throw err;
			}
		},

		async initializeDrive() {
			try {
				const result = await settingsApi.initializeDrive();
				await this.load();
				return result;
			} catch (err) {
				error = handleError(err);
				throw err;
			}
		},

		async listBackups() {
			try {
				return await settingsApi.listBackups();
			} catch (err) {
				error = handleError(err);
				throw err;
			}
		},

		async downloadBackupFromDrive(fileId: string) {
			if (!browser) return;
			try {
				const response = await settingsApi.downloadBackupFromDrive(fileId);
				if (!response.ok) throw new Error('Failed to download backup from Drive');

				const blob = await response.blob();
				const url = window.URL.createObjectURL(blob);
				const a = document.createElement('a');
				a.href = url;

				const contentDisposition = response.headers.get('Content-Disposition');
				let fileName = 'backup.zip';
				if (contentDisposition) {
					const matches = /filename="([^"]+)"/.exec(contentDisposition);
					if (matches?.[1]) fileName = matches[1];
				}

				a.download = fileName;
				document.body.appendChild(a);
				a.click();
				window.URL.revokeObjectURL(url);
				document.body.removeChild(a);
			} catch (err) {
				error = handleError(err);
				throw err;
			}
		},

		async restoreFromDriveBackup(
			fileId: string,
			mode: 'preview' | 'replace' | 'merge' = 'preview'
		) {
			try {
				const response = await settingsApi.downloadBackupFromDrive(fileId);
				if (!response.ok) throw new Error('Failed to download backup from Drive');

				const blob = await response.blob();
				const contentDisposition = response.headers.get('Content-Disposition');
				let fileName = 'backup.zip';
				if (contentDisposition) {
					const matches = /filename="([^"]+)"/.exec(contentDisposition);
					if (matches?.[1]) fileName = matches[1];
				}

				const file = new File([blob], fileName, { type: 'application/zip' });
				return await this.uploadBackup(file, mode);
			} catch (err) {
				error = handleError(err);
				throw err;
			}
		},

		async deleteBackup(fileId: string) {
			try {
				return await settingsApi.deleteBackup(fileId);
			} catch (err) {
				error = handleError(err);
				throw err;
			}
		},

		async restoreFromSheets(mode: 'preview' | 'replace' | 'merge' = 'preview') {
			try {
				const idempotencyKey = `restore-sheets-${mode}-${Date.now()}`;
				const result = await settingsApi.restoreFromSheets(mode, idempotencyKey);

				if (mode !== 'preview') {
					await this.load();
				}
				return result;
			} catch (err) {
				error = handleError(err);
				throw err;
			}
		},

		reset() {
			settings = null;
			isLoading = false;
			error = null;
		}
	};
}

export const settingsStore = createSettingsStore();
