import { apiClient } from './api-client';

export interface PushSubscribeInput {
	endpoint: string;
	keys: { p256dh: string; auth: string };
	userAgent?: string;
}

export const pushApi = {
	async getVapidPublicKey(): Promise<{ publicKey: string }> {
		return apiClient.get<{ publicKey: string }>('/api/v1/push/vapid-public-key');
	},

	async subscribe(input: PushSubscribeInput): Promise<{ id: string }> {
		return apiClient.post<{ id: string }>('/api/v1/push/subscribe', input);
	},

	async unsubscribe(endpoint: string): Promise<{ removed: boolean }> {
		return apiClient.delete<{ removed: boolean }>('/api/v1/push/subscribe', {
			body: { endpoint }
		});
	}
};
