import { apiClient } from './api-client';

export interface PushSubscribeInput {
	endpoint: string;
	keys: { p256dh: string; auth: string };
	userAgent?: string;
}

export type VapidKeyStatus =
	{ enabled: true; publicKey: string } | { enabled: false; publicKey: null };

export const pushApi = {
	async getVapidPublicKey(): Promise<VapidKeyStatus> {
		return apiClient.get<VapidKeyStatus>('/push/vapid-public-key');
	},

	async subscribe(input: PushSubscribeInput): Promise<{ id: string }> {
		return apiClient.post<{ id: string }>('/push/subscribe', input);
	},

	async unsubscribe(endpoint: string): Promise<{ removed: boolean }> {
		return apiClient.delete<{ removed: boolean }>('/push/subscribe', {
			body: { endpoint }
		});
	}
};
