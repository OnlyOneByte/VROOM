import type { LinkedAuthProvider, User } from '$lib/types';
import { apiClient } from '$lib/services/api-client';

export const authApi = {
	getProviders(): Promise<{ id: string; displayName: string }[]> {
		return apiClient.get<{ id: string; displayName: string }[]>('/api/v1/auth/providers');
	},

	updateProfile(data: { displayName: string }): Promise<{ user: User }> {
		return apiClient.patch<{ user: User }>('/api/v1/auth/me', data);
	},

	getLinkedAccounts(): Promise<LinkedAuthProvider[]> {
		return apiClient.get<LinkedAuthProvider[]>('/api/v1/auth/accounts');
	},

	unlinkAccount(id: string): Promise<void> {
		return apiClient.delete<void>(`/api/v1/auth/accounts/${id}`);
	}
};
