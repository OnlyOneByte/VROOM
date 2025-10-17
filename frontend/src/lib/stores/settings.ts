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

		async downloadBackup(format: 'json' | 'zip' = 'zip') {
			try {
				const response = await fetch(`/api/backup/download/${format}`, {
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
				a.download = `vroom-backup-${new Date().toISOString().split('T')[0]}.${format}`;
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

		async uploadBackupToDrive(format: 'json' | 'zip' = 'zip') {
			try {
				const response = await fetch('/api/backup/upload-to-drive', {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json'
					},
					credentials: 'include',
					body: JSON.stringify({ format })
				});

				if (!response.ok) {
					throw new Error('Failed to upload backup to Drive');
				}

				// Update last backup date
				await this.load();

				return await response.json();
			} catch (error) {
				const errorMessage =
					error instanceof Error ? error.message : 'Failed to upload backup to Drive';
				update(state => ({ ...state, error: errorMessage }));
				throw error;
			}
		},

		async syncToSheets() {
			try {
				const response = await fetch('/api/sheets/sync', {
					method: 'POST',
					credentials: 'include'
				});

				if (!response.ok) {
					throw new Error('Failed to sync to Google Sheets');
				}

				// Update last sync date
				await this.load();

				return await response.json();
			} catch (error) {
				const errorMessage =
					error instanceof Error ? error.message : 'Failed to sync to Google Sheets';
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
