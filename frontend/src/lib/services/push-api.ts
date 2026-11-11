/** Web Push HTTP transport. The browser Push API lives in $lib/utils/push. */

import { apiClient } from './api-client';

export interface PushSubscribeInput {
	endpoint: string;
	keys: { p256dh: string; auth: string };
	userAgent?: string;
}

export const pushApi = {
	// Throws ApiError with code PUSH_NOT_CONFIGURED (503) when the server has no VAPID keypair.
	async getVapidPublicKey(): Promise<{ publicKey: string }> {
		return apiClient.get<{ publicKey: string }>('/api/v1/push/vapid-public-key');
	},

	// Idempotent per (user, endpoint).
	async subscribe(input: PushSubscribeInput): Promise<{ id: string }> {
		return apiClient.post<{ id: string }>('/api/v1/push/subscribe', input);
	},

	// Unknown endpoints are a no-op.
	async unsubscribe(endpoint: string): Promise<{ removed: boolean }> {
		return apiClient.delete<{ removed: boolean }>('/api/v1/push/subscribe', {
			body: { endpoint }
		});
	}
};
