import { writable } from 'svelte/store';
import type { UserSettings } from '../types/index.js';
import { settingsApi } from '$lib/services/settings-api';

interface SettingsState {
	settings: UserSettings | null;
	isLoading: boolean;
	error: string | null;
}

const initialState: SettingsState = {
	settings: null,
	isLoading: false,
	error: null
};

function createSettingsStore() {
	const { subscribe, set, update } = writable<SettingsState>(initialState);

	function handleError(error: unknown): string {
		return error instanceof Error ? error.message : 'An unexpected error occurred';
	}

	return {
		subscribe,

		async load() {
			update(state => ({ ...state, isLoading: true, error: null }));
			try {
				const settings = await settingsApi.getSettings();
				update(state => ({ ...state, settings, isLoading: false }));
			} catch (error) {
				update(state => ({
					...state,
					error: handleError(error),
					isLoading: false
				}));
			}
		},

		async update(updates: Partial<UserSettings>) {
			update(state => ({ ...state, isLoading: true, error: null }));
			try {
				const settings = await settingsApi.updateSettings(updates);
				update(state => ({ ...state, settings, isLoading: false }));
				return settings;
			} catch (error) {
				const msg = handleError(error);
				update(state => ({ ...state, error: msg, isLoading: false }));
				throw error;
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
			} catch (error) {
				update(state => ({ ...state, error: handleError(error) }));
				throw error;
			}
		},

		async downloadBackup() {
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
			} catch (error) {
				update(state => ({ ...state, error: handleError(error) }));
				throw error;
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
			} catch (error) {
				update(state => ({ ...state, error: handleError(error) }));
				throw error;
			}
		},

		async executeSync(syncTypes: ('sheets' | 'backup')[]) {
			try {
				return await settingsApi.executeSync(syncTypes);
			} catch (error) {
				update(state => ({ ...state, error: handleError(error) }));
				throw error;
			}
		},

		async initializeDrive() {
			try {
				const result = await settingsApi.initializeDrive();
				await this.load();
				return result;
			} catch (error) {
				update(state => ({ ...state, error: handleError(error) }));
				throw error;
			}
		},

		async listBackups() {
			try {
				return await settingsApi.listBackups();
			} catch (error) {
				update(state => ({ ...state, error: handleError(error) }));
				throw error;
			}
		},

		async downloadBackupFromDrive(fileId: string) {
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
			} catch (error) {
				update(state => ({ ...state, error: handleError(error) }));
				throw error;
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
			} catch (error) {
				update(state => ({ ...state, error: handleError(error) }));
				throw error;
			}
		},

		async deleteBackup(fileId: string) {
			try {
				return await settingsApi.deleteBackup(fileId);
			} catch (error) {
				update(state => ({ ...state, error: handleError(error) }));
				throw error;
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
			} catch (error) {
				update(state => ({ ...state, error: handleError(error) }));
				throw error;
			}
		},

		reset() {
			set(initialState);
		}
	};
}

export const settingsStore = createSettingsStore();
