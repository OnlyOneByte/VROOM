import { beforeEach, describe, expect, test, vi } from 'vitest';
import { ApiError } from '#lib/utils/error-handling.ts';

const get = vi.fn();
const post = vi.fn();
const put = vi.fn();
const del = vi.fn();
const getPaginated = vi.fn();
vi.mock('../api-client', async importOriginal => ({
	...(await importOriginal<typeof import('../api-client')>()),
	apiClient: { get, post, put, delete: del, getPaginated }
}));

const { odometerApi } = await import('../odometer-api');

beforeEach(() => {
	for (const fn of [get, post, put, del, getPaginated]) fn.mockReset();
});

describe('odometerApi', () => {
	test('getEntries pages through the vehicle entries', async () => {
		getPaginated.mockResolvedValue({ data: [] });
		await odometerApi.getEntries('v1');
		await odometerApi.getEntries('v1', { limit: 20, offset: 40 });
		expect(getPaginated.mock.calls.map(c => c[0])).toEqual([
			'/api/v1/odometer/v1',
			'/api/v1/odometer/v1?limit=20&offset=40'
		]);
	});

	test('getEntry GETs a single entry by id', async () => {
		get.mockResolvedValueOnce({ id: 'o1' });
		await expect(odometerApi.getEntry('o1')).resolves.toEqual({ id: 'o1' });
		expect(get).toHaveBeenCalledWith('/api/v1/odometer/entry/o1');
	});

	test('create POSTs the reading to the vehicle path', async () => {
		const body = { odometer: 12_000, recordedAt: '2025-03-01T00:00:00.000Z', note: 'service' };
		post.mockResolvedValueOnce({ id: 'o2' });
		await odometerApi.create('v1', body);
		expect(post).toHaveBeenCalledWith('/api/v1/odometer/v1', body);
	});

	test('update PUTs and delete DELETEs the entry path', async () => {
		put.mockResolvedValueOnce({ id: 'o2' });
		del.mockResolvedValueOnce({ deleted: true });
		await odometerApi.update('o2', { odometer: 12_500 });
		await expect(odometerApi.delete('o2')).resolves.toBeUndefined();
		expect(put).toHaveBeenCalledWith('/api/v1/odometer/o2', { odometer: 12_500 });
		expect(del).toHaveBeenCalledWith('/api/v1/odometer/o2');
	});

	test('uploadPhoto posts multipart data to the odometer entry collection', async () => {
		post.mockResolvedValueOnce({ id: 'p1' });
		await odometerApi.uploadPhoto('o2', new File(['x'], 'dash.jpg'));
		const [url, body] = post.mock.calls[0] ?? [];
		expect(url).toBe('/api/v1/photos/odometer_entry/o2');
		expect((body as FormData).get('photo')).toBeInstanceOf(File);
	});

	test('a rejected create propagates the API error', async () => {
		const failure = new ApiError('Odometer must increase', 422);
		post.mockRejectedValueOnce(failure);
		await expect(
			odometerApi.create('v1', { odometer: 1, recordedAt: '2025-03-01T00:00:00.000Z' })
		).rejects.toBe(failure);
	});
});
