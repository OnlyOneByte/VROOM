import type { LinkedAuthProvider, User } from '#lib/types/index.ts';
import { apiClient } from '#lib/services/api-client.ts';

export const authApi = {
	getProviders(): Promise<{ id: string; displayName: string }[]> {
		return apiClient.get<{ id: string; displayName: string }[]>('/auth/providers');
	},

	updateProfile(data: { displayName: string }): Promise<{ user: User }> {
		return apiClient.patch<{ user: User }>('/auth/me', data);
	},

	getLinkedAccounts(): Promise<LinkedAuthProvider[]> {
		return apiClient.get<LinkedAuthProvider[]>('/auth/accounts');
	},

	unlinkAccount(id: string): Promise<void> {
		return apiClient.delete<void>(`/auth/accounts/${id}`);
	}
};
