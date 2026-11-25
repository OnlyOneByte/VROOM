import { apiClient } from './api-client';
import type { PackedRules } from '#lib/utils/permissions.ts';

export type SignupMode = 'open' | 'approval' | 'invite' | 'closed';

export interface SignupSettings {
	mode: SignupMode;
	modeLocked: boolean;
	allowedDomains: string[];
	domainsLocked: boolean;
}

export type InviteStatus = 'active' | 'used' | 'expired' | 'revoked';

export interface ServerInvite {
	id: string;
	email: string;
	status: InviteStatus;
	createdAt: string | null;
	expiresAt: string;
	usedAt: string | null;
	revokedAt: string | null;
}

export interface PendingAccount {
	id: string;
	email: string;
	displayName: string;
	pendingSince: string | null;
}

export const signupApi = {
	async serverRules(): Promise<PackedRules> {
		return (await apiClient.get<{ rules: PackedRules }>('/auth/capabilities')).rules;
	},

	getSettings(): Promise<SignupSettings> {
		return apiClient.get<SignupSettings>('/admin/signup');
	},

	updateSettings(
		change: Partial<Pick<SignupSettings, 'mode' | 'allowedDomains'>>
	): Promise<SignupSettings> {
		return apiClient.put<SignupSettings>('/admin/signup', change);
	},

	listInvites(): Promise<ServerInvite[]> {
		return apiClient.get<ServerInvite[]>('/admin/invites');
	},

	createInvite(email: string, expiresInDays: number): Promise<ServerInvite> {
		return apiClient.post<ServerInvite>('/admin/invites', { email, expiresInDays });
	},

	revokeInvite(id: string): Promise<ServerInvite> {
		return apiClient.delete<ServerInvite>(`/admin/invites/${id}`);
	},

	listPending(): Promise<PendingAccount[]> {
		return apiClient.get<PendingAccount[]>('/admin/pending-accounts');
	},

	approve(id: string): Promise<void> {
		return apiClient.post<void>(`/admin/pending-accounts/${id}/approve`);
	},

	reject(id: string): Promise<void> {
		return apiClient.delete<void>(`/admin/pending-accounts/${id}`);
	}
};
