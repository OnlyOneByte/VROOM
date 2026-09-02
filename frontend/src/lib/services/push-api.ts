/**
 * Web Push API client (push-notifications T5 — the FE opt-in surface).
 *
 * A thin typed wrapper over the shipped backend push router (`/api/v1/push`, backend T2/T3):
 *   - `getVapidPublicKey()` → GET /vapid-public-key → `{ publicKey }`. When the server has no VAPID
 *     keypair the backend answers 503 `PUSH_NOT_CONFIGURED`, which the shared client turns into an
 *     `ApiError` with `code === 'PUSH_NOT_CONFIGURED'` — the caller degrades to "not configured" (R6).
 *   - `subscribe(input)` → POST /subscribe → `{ id }`. Persists THIS browser's Web Push subscription
 *     for the session user (idempotent on (userId, endpoint) server-side; the crypto keys are never
 *     echoed back — only the row id).
 *   - `unsubscribe(endpoint)` → DELETE /subscribe → `{ removed }`. Idempotent no-op on an unknown
 *     endpoint; scoped to the session user (a subscription is not a cross-user capability).
 *
 * All calls carry the session cookie via the shared `apiClient` (credentials: 'include'). This client
 * does NOT touch the browser Push API — that lives in `$lib/utils/push` (feature-detect + subscribe
 * lifecycle); this file is only the transport.
 */

import { apiClient } from './api-client';

/** The subscription payload the backend expects (mirrors PushSubscription.toJSON() + a UA hint). */
export interface PushSubscribeInput {
	/** The push service endpoint URL the server will later POST to (browser-vendor host). */
	endpoint: string;
	/** The client public key + auth secret from the browser's PushSubscription. */
	keys: { p256dh: string; auth: string };
	/** Optional UA string, stored to help the user recognize a device in a future manage-devices view. */
	userAgent?: string;
}

export const pushApi = {
	/**
	 * Fetch the app-wide VAPID public key (the applicationServerKey pushManager.subscribe() needs).
	 * Throws an `ApiError` (code `PUSH_NOT_CONFIGURED`, status 503) when push is not configured on the
	 * server — the caller treats that as "feature off" rather than an error.
	 */
	async getVapidPublicKey(): Promise<{ publicKey: string }> {
		return apiClient.get<{ publicKey: string }>('/api/v1/push/vapid-public-key');
	},

	/** Persist this browser's Web Push subscription for the session user. Returns the stored row id. */
	async subscribe(input: PushSubscribeInput): Promise<{ id: string }> {
		return apiClient.post<{ id: string }>('/api/v1/push/subscribe', input);
	},

	/** Remove this browser's subscription (by endpoint). Idempotent — an unknown endpoint is a no-op. */
	async unsubscribe(endpoint: string): Promise<{ removed: boolean }> {
		return apiClient.delete<{ removed: boolean }>('/api/v1/push/subscribe', {
			body: { endpoint }
		});
	}
};
