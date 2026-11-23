import { beforeEach, describe, expect, test, vi } from 'vitest';
import { ApiError } from '#lib/utils/error-handling.ts';

const get = vi.fn();
const post = vi.fn();
const put = vi.fn();
const del = vi.fn();
vi.mock('../api-client', () => ({
	apiClient: { get, post, put, delete: del }
}));

const { providerApi } = await import('../provider-api');

beforeEach(() => {
	for (const fn of [get, post, put, del]) fn.mockReset();
});

describe('providerApi', () => {
	test('getProviders lists all providers or filters by an encoded domain', async () => {
		get.mockResolvedValue([]);
		await providerApi.getProviders();
		await providerApi.getProviders('photos & docs');
		expect(get.mock.calls.map(c => c[0])).toEqual([
			'/providers',
			'/providers?domain=photos%20%26%20docs'
		]);
	});

	test('createProvider POSTs the provider definition', async () => {
		const data = {
			domain: 'storage',
			providerType: 'google-drive',
			displayName: 'My Drive',
			credentials: { refreshToken: 'r' },
			nonce: 'n1'
		};
		post.mockResolvedValueOnce({ id: 'pr1' });
		await providerApi.createProvider(data);
		expect(post).toHaveBeenCalledWith('/providers', data);
	});

	test('updateProvider PUTs and deleteProvider DELETEs the provider path', async () => {
		put.mockResolvedValueOnce({ id: 'pr1' });
		del.mockResolvedValueOnce({ deleted: true });
		await providerApi.updateProvider('pr1', { displayName: 'Renamed' });
		await expect(providerApi.deleteProvider('pr1')).resolves.toBeUndefined();
		expect(put).toHaveBeenCalledWith('/providers/pr1', { displayName: 'Renamed' });
		expect(del).toHaveBeenCalledWith('/providers/pr1');
	});

	test('backfillProvider POSTs with no body and returns the created count', async () => {
		post.mockResolvedValueOnce({ created: 7 });
		await expect(providerApi.backfillProvider('pr1')).resolves.toEqual({ created: 7 });
		expect(post).toHaveBeenCalledWith('/providers/pr1/backfill');
	});

	test('getSyncStatus returns per-entity counts', async () => {
		get.mockResolvedValueOnce({ photo: { total: 3, synced: 2, failed: 1 } });
		await expect(providerApi.getSyncStatus('pr1')).resolves.toEqual({
			photo: { total: 3, synced: 2, failed: 1 }
		});
		expect(get).toHaveBeenCalledWith('/providers/pr1/sync-status');
	});

	test('a failed backfill propagates the API error', async () => {
		const failure = new ApiError('Provider disconnected', 409);
		post.mockRejectedValueOnce(failure);
		await expect(providerApi.backfillProvider('pr1')).rejects.toBe(failure);
	});
});
