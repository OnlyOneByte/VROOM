import { beforeEach, describe, expect, test, vi } from 'vitest';
import { ApiError } from '#lib/utils/error-handling.ts';

const get = vi.fn();
const post = vi.fn();
const put = vi.fn();
const del = vi.fn();
const patch = vi.fn();
const getPaginated = vi.fn();
vi.mock('../api-client', () => ({
	apiClient: { get, post, put, patch, delete: del, getPaginated },
	getApiBaseUrl: () => 'https://api.example.com',
	withPagination: (url: string) => url
}));

const { vehicleApi } = await import('../vehicle-api');

beforeEach(() => {
	for (const fn of [get, post, put, patch, del, getPaginated]) fn.mockReset();
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

describe('vehicleApi request shapes', () => {
	test('getVehicle GETs the vehicle path', async () => {
		get.mockResolvedValueOnce({ id: 'v1' });
		await expect(vehicleApi.getVehicle('v1')).resolves.toEqual({ id: 'v1' });
		expect(get).toHaveBeenCalledWith('/api/v1/vehicles/v1');
	});

	test('getVehicles only asks for shared vehicles when requested', async () => {
		get.mockResolvedValue([]);
		await vehicleApi.getVehicles();
		await vehicleApi.getVehicles({ includeShared: false });
		await vehicleApi.getVehicles({ includeShared: true });
		expect(get.mock.calls.map(c => c[0])).toEqual([
			'/api/v1/vehicles',
			'/api/v1/vehicles',
			'/api/v1/vehicles?include=shared'
		]);
	});

	test('createVehicle and updateVehicle send the payload', async () => {
		post.mockResolvedValueOnce({ id: 'v2' });
		put.mockResolvedValueOnce({ id: 'v2' });
		await vehicleApi.createVehicle({ make: 'Honda' });
		await vehicleApi.updateVehicle('v2', { nickname: 'Daily' });
		expect(post).toHaveBeenCalledWith('/api/v1/vehicles', { make: 'Honda' });
		expect(put).toHaveBeenCalledWith('/api/v1/vehicles/v2', { nickname: 'Daily' });
	});

	test('getVehicleStats passes the period as a query parameter', async () => {
		get.mockResolvedValueOnce({});
		await vehicleApi.getVehicleStats('v1', '90d');
		expect(get).toHaveBeenCalledWith('/api/v1/vehicles/v1/stats?period=90d');
	});

	test('createFinancing POSTs to the vehicle financing path', async () => {
		post.mockResolvedValueOnce({ id: 'f1' });
		await vehicleApi.createFinancing('v1', { financingType: 'loan', originalAmount: 10_000 });
		expect(post).toHaveBeenCalledWith('/api/v1/financing/vehicles/v1/financing', {
			financingType: 'loan',
			originalAmount: 10_000
		});
	});

	test('updatePaymentAmount PATCHes only the new amount', async () => {
		patch.mockResolvedValueOnce({ id: 'f1', paymentAmount: 410 });
		await vehicleApi.updatePaymentAmount('f1', 410);
		expect(patch).toHaveBeenCalledWith('/api/v1/financing/f1/payment-amount', {
			paymentAmount: 410
		});
	});

	test('getAllVehiclePhotos and setCoverPhoto hit their endpoints', async () => {
		get.mockResolvedValueOnce({ v1: [] });
		put.mockResolvedValueOnce({ id: 'p1' });
		await expect(vehicleApi.getAllVehiclePhotos()).resolves.toEqual({ v1: [] });
		await vehicleApi.setCoverPhoto('v1', 'p1');
		expect(get).toHaveBeenCalledWith('/api/v1/photos?entityType=vehicle');
		expect(put).toHaveBeenCalledWith('/api/v1/vehicles/v1/photos/p1/cover');
	});

	test('a failed update propagates the API error', async () => {
		const failure = new ApiError('Conflict', 409);
		put.mockRejectedValueOnce(failure);
		await expect(vehicleApi.updateVehicle('v1', { nickname: 'x' })).rejects.toBe(failure);
	});
});
