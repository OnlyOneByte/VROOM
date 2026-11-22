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

vi.mock('../analytics-api', () => ({ userTimeZone: () => 'Pacific/Auckland' }));

const { isOdometerOrderError, odometerApi } = await import('../odometer-api');

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

	test('create POSTs the reading to the vehicle path with the user time zone', async () => {
		const body = { odometer: 12_000, recordedAt: '2025-03-01T00:00:00.000Z', note: 'service' };
		post.mockResolvedValueOnce({ id: 'o2' });
		await odometerApi.create('v1', body);
		expect(post).toHaveBeenCalledWith('/api/v1/odometer/v1', {
			...body,
			timeZone: 'Pacific/Auckland'
		});
	});

	test('update PUTs with the user time zone and delete DELETEs the entry path', async () => {
		put.mockResolvedValueOnce({ id: 'o2' });
		del.mockResolvedValueOnce({ deleted: true });
		await odometerApi.update('o2', { odometer: 12_500 });
		await expect(odometerApi.delete('o2')).resolves.toBeUndefined();
		expect(put).toHaveBeenCalledWith('/api/v1/odometer/o2', {
			odometer: 12_500,
			timeZone: 'Pacific/Auckland'
		});
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

describe('isOdometerOrderError', () => {
	test.each([
		'Mileage must be greater than 41,010 (from earlier entry)',
		'Mileage must be less than 50,000 (from later entry)',
		'Mileage cannot be less than initial mileage'
	])('recognises the server order refusal "%s"', message => {
		expect(isOdometerOrderError(new ApiError(message, 400))).toBe(true);
	});

	test.each([
		['another mileage message', new ApiError('Mileage must be greater than 0', 400)],
		['a mismatched pair', new ApiError('Mileage must be greater than 5 (from later entry)', 400)],
		['another status', new ApiError('Mileage must be greater than 5 (from earlier entry)', 409)],
		['a plain Error', new Error('Mileage must be greater than 5 (from earlier entry)')]
	])('ignores %s', (_label, error) => {
		expect(isOdometerOrderError(error)).toBe(false);
	});
});
