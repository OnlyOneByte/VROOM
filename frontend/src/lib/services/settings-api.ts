import type {
	BackupFileInfo,
	BackupOrchestratorResult,
	ProviderBackupList,
	RestoreProviderInfo,
	RestoreResult,
	UserSettings
} from '#lib/types/settings.ts';
import { RequestTimeoutError } from '#lib/utils/error-handling.ts';
import { apiClient } from './api-client';

export const RESTORE_TIMEOUT_MS = 25 * 60 * 1000;

async function withRestoreDeadline<T>(run: (signal: AbortSignal) => Promise<T>): Promise<T> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(new RequestTimeoutError()), RESTORE_TIMEOUT_MS);
	try {
		return await run(controller.signal);
	} finally {
		clearTimeout(timer);
	}
}

export const settingsApi = {
	async getSettings(): Promise<UserSettings> {
		return apiClient.get<UserSettings>('/settings');
	},

	async updateSettings(updates: Partial<UserSettings>): Promise<UserSettings> {
		return apiClient.put<UserSettings>('/settings', updates);
	},

	async resumeSheetsBackups(providerId: string): Promise<void> {
		await apiClient.post(`/sync/sheets/${encodeURIComponent(providerId)}/resume`, {});
	},

	async executeSync(
		syncTypes: 'backup'[],
		force = false,
		providerIds?: string[]
	): Promise<BackupOrchestratorResult> {
		return apiClient.post<BackupOrchestratorResult>('/sync', {
			syncTypes,
			force,
			...(providerIds && { providerIds })
		});
	},

	async listBackupsFromProvider(providerId: string): Promise<BackupFileInfo[]> {
		return apiClient.get<BackupFileInfo[]>(
			`/sync/backups/providers?providerId=${encodeURIComponent(providerId)}`
		);
	},

	async listAllBackups(): Promise<ProviderBackupList[]> {
		return apiClient.get<ProviderBackupList[]>('/sync/backups/providers');
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

		return withRestoreDeadline(signal =>
			apiClient.post<RestoreResult>('/sync/restore/from-provider', body, {
				headers: { 'Idempotency-Key': opts.idempotencyKey },
				signal
			})
		);
	},

	async getRestoreProviders(): Promise<RestoreProviderInfo[]> {
		return apiClient.get<RestoreProviderInfo[]>('/sync/restore/providers');
	},

	async downloadBackup(): Promise<Response> {
		return apiClient.raw('/sync/backups/download');
	},

	async uploadBackup(
		file: File,
		mode: 'preview' | 'replace' | 'merge',
		idempotencyKey: string
	): Promise<RestoreResult> {
		const formData = new FormData();
		formData.append('file', file);
		formData.append('mode', mode);

		return withRestoreDeadline(signal =>
			apiClient.post<RestoreResult>('/sync/restore/from-backup', formData, {
				headers: { 'Idempotency-Key': idempotencyKey },
				signal
			})
		);
	}
};
