import { writable } from 'svelte/store';
import type { UserSettings } from '../types/index.js';

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

	return {
		subscribe,

		async load() {
			update(state => ({ ...state, isLoading: true, error: null }));

			try {
				const response = await fetch('/api/settings', {
					credentials: 'include'
				});

				if (!response.ok) {
					throw new Error('Failed to load settings');
				}

				const result = await response.json();
				update(state => ({
					...state,
					settings: result.data,
					isLoading: false
				}));
			} catch (error) {
				const errorMessage = error instanceof Error ? error.message : 'Failed to load settings';
				update(state => ({
					...state,
					error: errorMessage,
					isLoading: false
				}));
			}
		},

		async update(updates: Partial<UserSettings>) {
			update(state => ({ ...state, isLoading: true, error: null }));

			try {
				const response = await fetch('/api/settings', {
					method: 'PUT',
					headers: {
						'Content-Type': 'application/json'
					},
					credentials: 'include',
					body: JSON.stringify(updates)
				});

				if (!response.ok) {
					throw new Error('Failed to update settings');
				}

				const result = await response.json();
				update(state => ({
					...state,
					settings: result.data,
					isLoading: false
				}));

				return result.data;
			} catch (error) {
				const errorMessage = error instanceof Error ? error.message : 'Failed to update settings';
				update(state => ({
					...state,
					error: errorMessage,
					isLoading: false
				}));
				throw error;
			}
		},

		async configureSyncSettings(config: {
			googleSheetsSyncEnabled?: boolean;
			googleDriveBackupEnabled?: boolean;
			syncInactivityMinutes?: number;
		}) {
			try {
				const response = await fetch('/api/sync/configure', {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json'
					},
					credentials: 'include',
					body: JSON.stringify(config)
				});

				if (!response.ok) {
					throw new Error('Failed to configure sync settings');
				}

				// Reload settings to get updated values
				await this.load();

				return await response.json();
			} catch (error) {
				const errorMessage =
					error instanceof Error ? error.message : 'Failed to configure sync settings';
				update(state => ({ ...state, error: errorMessage }));
				throw error;
			}
		},

		async getSyncStatus() {
			try {
				const response = await fetch('/api/sync/status', {
					credentials: 'include'
				});

				if (!response.ok) {
					throw new Error('Failed to get sync status');
				}

				return await response.json();
			} catch (error) {
				const errorMessage = error instanceof Error ? error.message : 'Failed to get sync status';
				update(state => ({ ...state, error: errorMessage }));
				throw error;
			}
		},

		async downloadBackup() {
			try {
				const response = await fetch('/api/sync/download', {
					credentials: 'include'
				});

				if (!response.ok) {
					throw new Error('Failed to download backup');
				}

				// Download the file
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
				const errorMessage = error instanceof Error ? error.message : 'Failed to download backup';
				update(state => ({ ...state, error: errorMessage }));
				throw error;
			}
		},

		async uploadBackup(file: File, mode: 'preview' | 'replace' | 'merge' = 'preview') {
			try {
				const formData = new FormData();
				formData.append('file', file);
				formData.append('mode', mode);

				const response = await fetch('/api/sync/upload', {
					method: 'POST',
					credentials: 'include',
					body: formData
				});

				if (!response.ok) {
					throw new Error('Failed to upload backup');
				}

				const result = await response.json();

				// Reload settings if restore was successful
				if (mode !== 'preview' && result.success) {
					await this.load();
				}

				return result;
			} catch (error) {
				const errorMessage = error instanceof Error ? error.message : 'Failed to upload backup';
				update(state => ({ ...state, error: errorMessage }));
				throw error;
			}
		},

		async executeSync(syncTypes: ('sheets' | 'backup')[]) {
			try {
				const response = await fetch('/api/sync', {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json'
					},
					credentials: 'include',
					body: JSON.stringify({ syncTypes })
				});

				if (!response.ok) {
					throw new Error('Failed to execute sync');
				}

				// Reload settings to get updated timestamps
				await this.load();

				return await response.json();
			} catch (error) {
				const errorMessage = error instanceof Error ? error.message : 'Failed to execute sync';
				update(state => ({ ...state, error: errorMessage }));
				throw error;
			}
		},

		async listBackups() {
			try {
				const response = await fetch('/api/sync/backups', {
					credentials: 'include'
				});

				if (!response.ok) {
					throw new Error('Failed to list backups');
				}

				return await response.json();
			} catch (error) {
				const errorMessage = error instanceof Error ? error.message : 'Failed to list backups';
				update(state => ({ ...state, error: errorMessage }));
				throw error;
			}
		},

		async deleteBackup(fileId: string) {
			try {
				const response = await fetch(`/api/sync/backups/${fileId}`, {
					method: 'DELETE',
					credentials: 'include'
				});

				if (!response.ok) {
					throw new Error('Failed to delete backup');
				}

				return await response.json();
			} catch (error) {
				const errorMessage = error instanceof Error ? error.message : 'Failed to delete backup';
				update(state => ({ ...state, error: errorMessage }));
				throw error;
			}
		},

		async restoreFromSheets(mode: 'preview' | 'replace' | 'merge' = 'preview') {
			try {
				const response = await fetch('/api/sync/restore-from-sheets', {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json'
					},
					credentials: 'include',
					body: JSON.stringify({ mode })
				});

				if (!response.ok) {
					throw new Error('Failed to restore from sheets');
				}

				const result = await response.json();

				// Reload settings if restore was successful
				if (mode !== 'preview' && result.success) {
					await this.load();
				}

				return result;
			} catch (error) {
				const errorMessage =
					error instanceof Error ? error.message : 'Failed to restore from sheets';
				update(state => ({ ...state, error: errorMessage }));
				throw error;
			}
		},

		reset() {
			set(initialState);
		}
	};
}

export const settingsStore = createSettingsStore();
