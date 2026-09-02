/**
 * push-api.ts client guard (push-notifications T5) — the C149/C163 service-test pattern: apiClient is
 * mocked so we assert the exact endpoints + payloads the FE opt-in surface sends to the shipped backend
 * push router (GET vapid-public-key / POST subscribe / DELETE subscribe), including that the unsubscribe
 * carries the endpoint in the request BODY (the backend DELETE reads `{ endpoint }` from the body).
 */

import { beforeEach, describe, expect, test, vi } from 'vitest';

const get = vi.fn();
const post = vi.fn();
const del = vi.fn();
vi.mock('../api-client', () => ({
	apiClient: { get, post, delete: del },
	getApiBaseUrl: () => ''
}));

const { pushApi } = await import('../push-api');

beforeEach(() => {
	get.mockReset();
	post.mockReset();
	del.mockReset();
});

describe('pushApi.getVapidPublicKey', () => {
	test('GETs the vapid-public-key endpoint and returns the key', async () => {
		get.mockResolvedValue({ publicKey: 'BPk_test_key' });

		const out = await pushApi.getVapidPublicKey();

		expect(get).toHaveBeenCalledTimes(1);
		expect(get.mock.calls[0]?.[0]).toBe('/api/v1/push/vapid-public-key');
		expect(out).toEqual({ publicKey: 'BPk_test_key' });
	});

	test('propagates the 503 PUSH_NOT_CONFIGURED error from the client', async () => {
		get.mockRejectedValue(new Error('PUSH_NOT_CONFIGURED'));
		await expect(pushApi.getVapidPublicKey()).rejects.toThrow('PUSH_NOT_CONFIGURED');
	});
});

describe('pushApi.subscribe', () => {
	test('POSTs the endpoint + keys + userAgent to /push/subscribe and returns the row id', async () => {
		post.mockResolvedValue({ id: 'sub-1' });

		const out = await pushApi.subscribe({
			endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
			keys: { p256dh: 'p256dh-key', auth: 'auth-secret' },
			userAgent: 'Mozilla/5.0 Test'
		});

		expect(post).toHaveBeenCalledTimes(1);
		const [url, body] = post.mock.calls[0] ?? [];
		expect(url).toBe('/api/v1/push/subscribe');
		expect(body.endpoint).toBe('https://fcm.googleapis.com/fcm/send/abc');
		expect(body.keys).toEqual({ p256dh: 'p256dh-key', auth: 'auth-secret' });
		expect(body.userAgent).toBe('Mozilla/5.0 Test');
		expect(out).toEqual({ id: 'sub-1' });
	});

	test('propagates a create error (e.g. a 422 unsupported endpoint)', async () => {
		post.mockRejectedValue(new Error('422'));
		await expect(
			pushApi.subscribe({ endpoint: 'https://x/y', keys: { p256dh: 'a', auth: 'b' } })
		).rejects.toThrow('422');
	});
});

describe('pushApi.unsubscribe', () => {
	test('DELETEs /push/subscribe with the endpoint in the request body', async () => {
		del.mockResolvedValue({ removed: true });

		const out = await pushApi.unsubscribe('https://fcm.googleapis.com/fcm/send/abc');

		expect(del).toHaveBeenCalledTimes(1);
		const [url, options] = del.mock.calls[0] ?? [];
		expect(url).toBe('/api/v1/push/subscribe');
		// The backend DELETE reads `{ endpoint }` from the body — it must ride in options.body.
		expect(options?.body).toEqual({ endpoint: 'https://fcm.googleapis.com/fcm/send/abc' });
		expect(out).toEqual({ removed: true });
	});

	test('propagates a delete error', async () => {
		del.mockRejectedValue(new Error('500'));
		await expect(pushApi.unsubscribe('https://x/y')).rejects.toThrow('500');
	});
});
