import { beforeEach, describe, expect, test, vi } from 'vitest';
import { ApiError } from '#lib/utils/error-handling.ts';

const del = vi.fn();
vi.mock('../api-client', () => ({
	apiClient: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: del }
}));

const { photosOnlyOnProvider, providerApi } = await import('../provider-api');

beforeEach(() => {
	del.mockReset();
});

describe('deleting a storage provider that holds the only copy of photos', () => {
	test('deleteProvider asks the server to force the delete only when told to', async () => {
		del.mockResolvedValue(undefined);
		await providerApi.deleteProvider('pr1');
		await providerApi.deleteProvider('pr1', { force: true });
		expect(del.mock.calls.map(c => c[0])).toEqual([
			'/api/v1/providers/pr1',
			'/api/v1/providers/pr1?force=true'
		]);
	});

	test('photosOnlyOnProvider reads the count from the 409 the server sends', () => {
		const conflict = new ApiError('2 photos are stored only in this provider.', 409, {
			photosOnlyHere: 2
		});
		expect(photosOnlyOnProvider(conflict)).toBe(2);
	});

	test('photosOnlyOnProvider ignores other errors', () => {
		expect(photosOnlyOnProvider(new ApiError('Not found', 404))).toBeNull();
		expect(photosOnlyOnProvider(new ApiError('Conflict', 409, { other: 1 }))).toBeNull();
		expect(photosOnlyOnProvider(new Error('network'))).toBeNull();
	});
});
