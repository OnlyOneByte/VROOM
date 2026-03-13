import type { LinkedAuthProvider } from '$lib/types';
import { apiClient } from '$lib/services/api-client';

export const authApi = {
	getProviders(): Promise<{ id: string; displayName: string }[]> {
		return apiClient.get<{ id: string; displayName: string }[]>('/api/v1/auth/providers');
	},

	getLinkedAccounts(): Promise<LinkedAuthProvider[]> {
		return apiClient.get<LinkedAuthProvider[]>('/api/v1/auth/accounts');
	},

	unlinkAccount(id: string): Promise<void> {
		return apiClient.delete<void>(`/api/v1/auth/accounts/${id}`);
	}
};
