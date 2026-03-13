/**
 * Provider API service
 * Centralized API calls for storage provider management
 */

import type { UserProviderInfo } from '$lib/types';
import { apiClient } from './api-client';

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
	async getProviders(domain?: string): Promise<UserProviderInfo[]> {
		const params = domain ? `?domain=${encodeURIComponent(domain)}` : '';
		return apiClient.get<UserProviderInfo[]>(`/api/v1/providers${params}`);
	},

	async createProvider(data: CreateProviderData): Promise<UserProviderInfo> {
		return apiClient.post<UserProviderInfo>('/api/v1/providers', data);
	},

	async updateProvider(id: string, data: UpdateProviderData): Promise<UserProviderInfo> {
		return apiClient.put<UserProviderInfo>(`/api/v1/providers/${id}`, data);
	},

	async deleteProvider(id: string): Promise<void> {
		await apiClient.delete(`/api/v1/providers/${id}`);
	},

	async testProvider(id: string): Promise<{ healthy: boolean }> {
		return apiClient.post<{ healthy: boolean }>(`/api/v1/providers/${id}/test`);
	},

	async backfillProvider(id: string): Promise<{ created: number }> {
		return apiClient.post<{ created: number }>(`/api/v1/providers/${id}/backfill`);
	},

	async getSyncStatus(
		id: string
	): Promise<Record<string, { total: number; synced: number; failed: number }>> {
		return apiClient.get<Record<string, { total: number; synced: number; failed: number }>>(
			`/api/v1/providers/${id}/sync-status`
		);
	}
};
