/**
 * Settings API service
 * Centralized API calls for settings and sync operations using apiClient
 */

import type { UserSettings } from '$lib/types';
import { apiClient } from './api-client';

/** Generic API response envelope */
interface ApiEnvelope<T = unknown> {
	success: boolean;
	data?: T;
	message?: string;
}

interface RestorePreview {
	vehicles?: number;
	expenses?: number;
	settings?: number;
	financing?: number;
	[key: string]: number | undefined;
}

interface RestoreResult {
	success: boolean;
	preview?: RestorePreview;
	imported?: Record<string, number>;
	conflicts?: Array<{ field: string; local: unknown; remote: unknown }>;
	data?: RestoreResult;
}

interface BackupListResult {
	success: boolean;
	data?: Array<{ id: string; name: string; createdTime: string; size: string }>;
}

interface SyncResult {
	success: boolean;
	data?: {
		results: Record<string, { success: boolean; message?: string; skipped?: boolean }>;
	};
}

export const settingsApi = {
	async getSettings(): Promise<UserSettings> {
		return apiClient.get<UserSettings>('/api/v1/settings');
	},

	async updateSettings(updates: Partial<UserSettings>): Promise<UserSettings> {
		return apiClient.put<UserSettings>('/api/v1/settings', updates);
	},

	async configureSyncSettings(config: {
		googleSheetsSyncEnabled?: boolean;
		googleDriveBackupEnabled?: boolean;
		syncInactivityMinutes?: number;
	}): Promise<ApiEnvelope> {
		return apiClient.post<ApiEnvelope>('/api/v1/sync/configure', config);
	},

	async executeSync(syncTypes: ('sheets' | 'backup')[]): Promise<SyncResult> {
		return apiClient.post<SyncResult>('/api/v1/sync', { syncTypes });
	},

	async initializeDrive(): Promise<ApiEnvelope> {
		return apiClient.post<ApiEnvelope>('/api/v1/sync/backups/initialize-drive');
	},

	async listBackups(): Promise<BackupListResult> {
		return apiClient.get<BackupListResult>('/api/v1/sync/backups');
	},

	async deleteBackup(fileId: string): Promise<ApiEnvelope> {
		return apiClient.delete<ApiEnvelope>(`/api/v1/sync/backups/${fileId}`);
	},

	async downloadBackup(): Promise<Response> {
		return apiClient.raw('/api/v1/sync/backups/download');
	},

	async downloadBackupFromDrive(fileId: string): Promise<Response> {
		return apiClient.raw(`/api/v1/sync/backups/${fileId}/download`);
	},

	async uploadBackup(
		file: File,
		mode: 'preview' | 'replace' | 'merge',
		idempotencyKey: string
	): Promise<RestoreResult> {
		const formData = new FormData();
		formData.append('file', file);
		formData.append('mode', mode);

		return apiClient.post<RestoreResult>('/api/v1/sync/restore/from-backup', formData, {
			headers: { 'Idempotency-Key': idempotencyKey }
		});
	},

	async restoreFromSheets(
		mode: 'preview' | 'replace' | 'merge',
		idempotencyKey: string
	): Promise<RestoreResult> {
		return apiClient.post<RestoreResult>(
			'/api/v1/sync/restore/from-sheets',
			{ mode },
			{ headers: { 'Idempotency-Key': idempotencyKey } }
		);
	}
};
