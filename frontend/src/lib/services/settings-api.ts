/**
 * Settings API service
 * Centralized API calls for settings and sync operations using apiClient
 */

import type {
	BackupFileInfo,
	BackupOrchestratorResult,
	ProviderBackupList,
	RestoreProviderInfo,
	RestoreResult,
	UserSettings
} from '$lib/types/settings';
import { apiClient } from './api-client';

interface SyncResponse {
	success: boolean;
	data?: BackupOrchestratorResult;
}

export const settingsApi = {
	async getSettings(): Promise<UserSettings> {
		return apiClient.get<UserSettings>('/api/v1/settings');
	},

	async updateSettings(updates: Partial<UserSettings>): Promise<UserSettings> {
		return apiClient.put<UserSettings>('/api/v1/settings', updates);
	},

	async executeSync(syncTypes: 'backup'[], force = false): Promise<SyncResponse> {
		return apiClient.post<SyncResponse>('/api/v1/sync', { syncTypes, force });
	},

	async listBackupsFromProvider(providerId: string): Promise<BackupFileInfo[]> {
		return apiClient.get<BackupFileInfo[]>(
			`/api/v1/sync/backups/providers?providerId=${encodeURIComponent(providerId)}`
		);
	},

	async listAllBackups(): Promise<ProviderBackupList[]> {
		return apiClient.get<ProviderBackupList[]>('/api/v1/sync/backups/providers');
	},

	async restoreFromProvider(opts: {
		providerId: string;
		sourceType: 'zip' | 'sheets';
		mode: 'preview' | 'replace' | 'merge';
		fileRef?: string;
		idempotencyKey: string;
	}): Promise<RestoreResult> {
		const body: Record<string, string> =
			opts.sourceType === 'zip'
				? {
						providerId: opts.providerId,
						sourceType: 'zip',
						fileRef: opts.fileRef!,
						mode: opts.mode
					}
				: { providerId: opts.providerId, sourceType: 'sheets', mode: opts.mode };

		return apiClient.post<RestoreResult>('/api/v1/sync/restore/from-provider', body, {
			headers: { 'Idempotency-Key': opts.idempotencyKey }
		});
	},

	async getRestoreProviders(): Promise<RestoreProviderInfo[]> {
		return apiClient.get<RestoreProviderInfo[]>('/api/v1/sync/restore/providers');
	},

	async downloadBackup(): Promise<Response> {
		return apiClient.raw('/api/v1/sync/backups/download');
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
	}
};
