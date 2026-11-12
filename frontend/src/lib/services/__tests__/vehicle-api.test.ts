import { beforeEach, describe, expect, test, vi } from 'vitest';
import { ApiError } from '#lib/utils/error-handling.ts';

const get = vi.fn();
const post = vi.fn();
const put = vi.fn();
const del = vi.fn();
const getPaginated = vi.fn();
vi.mock('../api-client', () => ({
	apiClient: { get, post, put, delete: del, getPaginated },
	getApiBaseUrl: () => 'https://api.example.com',
	withPagination: (url: string) => url
}));

const { vehicleApi } = await import('../vehicle-api');

beforeEach(() => {
	for (const fn of [get, post, put, del, getPaginated]) fn.mockReset();
});

describe('vehicleApi.getFinancing', () => {
	test('returns null when the backend reports no financing (data: null)', async () => {
		get.mockResolvedValueOnce(null);
		await expect(vehicleApi.getFinancing('v1')).resolves.toBeNull();
		expect(get).toHaveBeenCalledWith('/api/v1/financing/vehicles/v1/financing');
	});

	test.each([401, 403, 404, 500])(
		'rethrows a %i instead of reporting "no financing"',
		async status => {
			const failure = new ApiError('boom', status);
			get.mockRejectedValueOnce(failure);
			await expect(vehicleApi.getFinancing('v1')).rejects.toBe(failure);
		}
	);
});

describe('vehicleApi photo wiring', () => {
	test('photo calls target the vehicle photo collection', async () => {
		const file = new File(['x'], 'car.jpg');
		await vehicleApi.getPhotos('v1');
		await vehicleApi.uploadPhoto('v1', file);
		await vehicleApi.deletePhoto('v1', 'p1');

		expect(getPaginated).toHaveBeenCalledWith('/api/v1/vehicles/v1/photos');
		const [uploadUrl, body] = post.mock.calls[0] ?? [];
		expect(uploadUrl).toBe('/api/v1/vehicles/v1/photos');
		expect((body as FormData).get('photo')).toBeInstanceOf(File);
		expect(del).toHaveBeenCalledWith('/api/v1/vehicles/v1/photos/p1');
		expect(vehicleApi.getPhotoThumbnailUrl('v1', 'p1')).toBe(
			'https://api.example.com/api/v1/vehicles/v1/photos/p1/thumbnail'
		);
	});

	test('deleteVehicle DELETEs the vehicle path', async () => {
		await vehicleApi.deleteVehicle('v9');
		expect(del).toHaveBeenCalledWith('/api/v1/vehicles/v9');
	});
});
