import type { UserProviderInfo } from '#lib/types/index.ts';
import { ApiError } from '#lib/utils/error-handling.ts';
import type { CatalogEntry } from '#lib/stores/provider-catalog.svelte.ts';
import { apiClient } from './api-client';

export function photosOnlyOnProvider(error: unknown): number | null {
	if (!(error instanceof ApiError) || error.statusCode !== 409) return null;
	const count = error.details?.['photosOnlyHere'];
	return typeof count === 'number' ? count : null;
}

interface CreateProviderData {
	domain: string;
	providerType: string;
	displayName: string;
	credentials: Record<string, unknown>;
	config?: Record<string, unknown>;
	nonce?: string;
}

interface UpdateProviderData {
	displayName?: string;
	credentials?: Record<string, unknown>;
	config?: Record<string, unknown>;
}

export const providerApi = {
	async getCatalog(): Promise<CatalogEntry[]> {
		return apiClient.get<CatalogEntry[]>('/providers/catalog');
	},

	async getProviders(domain?: string): Promise<UserProviderInfo[]> {
		const params = domain ? `?domain=${encodeURIComponent(domain)}` : '';
		return apiClient.get<UserProviderInfo[]>(`/providers${params}`);
	},

	async createProvider(data: CreateProviderData): Promise<UserProviderInfo> {
		return apiClient.post<UserProviderInfo>('/providers', data);
	},

	async updateProvider(id: string, data: UpdateProviderData): Promise<UserProviderInfo> {
		return apiClient.put<UserProviderInfo>(`/providers/${id}`, data);
	},

	async deleteProvider(id: string, options: { force?: boolean } = {}): Promise<void> {
		await apiClient.delete(`/providers/${id}${options.force ? '?force=true' : ''}`);
	},

	async backfillProvider(id: string): Promise<{ created: number }> {
		return apiClient.post<{ created: number }>(`/providers/${id}/backfill`);
	},

	async getSyncStatus(
		id: string
	): Promise<Record<string, { total: number; synced: number; failed: number }>> {
		return apiClient.get<Record<string, { total: number; synced: number; failed: number }>>(
			`/providers/${id}/sync-status`
		);
	}
};
