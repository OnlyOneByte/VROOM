/**
 * trip-api.ts coverage (trips-location T6 FE seam) — the C149/C163 service-test pattern: apiClient is
 * mocked, so each method's exact URL + payload is asserted (guards against a wrong-segment typo) plus the
 * query-string construction (filter-drop on empty vehicleId/purpose, the summary rate param). The wrappers
 * are thin passthroughs (apiClient already unwraps the { success, data } envelope), so they return data
 * verbatim — no transform layer here (trips carry no split/electric fields, unlike expenses).
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { Trip, TripSummary } from '$lib/types';
import { tripDistance } from '$lib/types';

const get = vi.fn();
const post = vi.fn();
const put = vi.fn();
const del = vi.fn();
const getPaginated = vi.fn();

vi.mock('../api-client', () => ({
	apiClient: { get, post, put, delete: del, getPaginated }
}));

const { tripApi } = await import('../trip-api');

const TRIP: Trip = {
	id: 't1',
	vehicleId: 'v1',
	startOdometer: 1000,
	endOdometer: 1080,
	purpose: 'business',
	tripDate: '2024-06-20T12:00:00.000Z',
	startLocation: null,
	endLocation: null,
	note: null,
	createdAt: '2024-06-20T12:00:00.000Z',
	updatedAt: '2024-06-20T12:00:00.000Z'
};

beforeEach(() => {
	for (const fn of [get, post, put, del, getPaginated]) fn.mockReset();
});
afterEach(() => vi.clearAllMocks());

describe('tripApi.list (paginated + filter-drop)', () => {
	test('no filters → bare /api/v1/trips, getPaginated passthrough', async () => {
		getPaginated.mockResolvedValueOnce({ data: [TRIP], pagination: { totalCount: 1 } });
		const res = await tripApi.list();
		expect(getPaginated).toHaveBeenCalledWith('/api/v1/trips');
		expect(res.data).toEqual([TRIP]);
	});

	test('vehicleId + purpose + pagination are serialized', async () => {
		getPaginated.mockResolvedValueOnce({ data: [], pagination: { totalCount: 0 } });
		await tripApi.list({ vehicleId: 'v1', purpose: 'business', limit: 10, offset: 20 });
		const url = getPaginated.mock.calls[0]?.[0] as string;
		expect(url).toContain('vehicleId=v1');
		expect(url).toContain('purpose=business');
		expect(url).toContain('limit=10');
		expect(url).toContain('offset=20');
	});

	test('an empty vehicleId is DROPPED (not serialized as vehicleId=)', async () => {
		getPaginated.mockResolvedValueOnce({ data: [], pagination: { totalCount: 0 } });
		await tripApi.list({ vehicleId: '' });
		const url = getPaginated.mock.calls[0]?.[0] as string;
		expect(url).not.toContain('vehicleId=');
	});
});

describe('tripApi.getSummary (R4 rollup)', () => {
	const SUMMARY: TripSummary = {
		tripCount: 2,
		totalMiles: 150,
		milesByPurpose: { business: 100, personal: 50, commute: 0, other: 0 },
		averageTripMiles: 75,
		businessMiles: 100,
		businessMileageValue: 67,
		rate: 0.67
	};

	test('no params → bare /api/v1/trips/summary', async () => {
		get.mockResolvedValueOnce(SUMMARY);
		const res = await tripApi.getSummary();
		expect(get).toHaveBeenCalledWith('/api/v1/trips/summary');
		expect(res).toEqual(SUMMARY);
	});

	test('vehicleId + rate are serialized (rate=0 survives, it is a real number)', async () => {
		get.mockResolvedValueOnce(SUMMARY);
		await tripApi.getSummary({ vehicleId: 'v1', rate: 0.67 });
		const url = get.mock.calls[0]?.[0] as string;
		expect(url).toContain('/api/v1/trips/summary?');
		expect(url).toContain('vehicleId=v1');
		expect(url).toContain('rate=0.67');
	});
});

describe('tripApi CRUD wiring', () => {
	test('getByVehicle hits the vehicle sub-path', async () => {
		get.mockResolvedValueOnce([TRIP]);
		const res = await tripApi.getByVehicle('v1');
		expect(get).toHaveBeenCalledWith('/api/v1/trips/vehicle/v1');
		expect(res).toEqual([TRIP]);
	});

	test('getById interpolates the id', async () => {
		get.mockResolvedValueOnce(TRIP);
		await tripApi.getById('t1');
		expect(get).toHaveBeenCalledWith('/api/v1/trips/t1');
	});

	test('create POSTs the body to /api/v1/trips', async () => {
		post.mockResolvedValueOnce(TRIP);
		const body = {
			vehicleId: 'v1',
			startOdometer: 1000,
			endOdometer: 1080,
			purpose: 'business' as const,
			tripDate: '2024-06-20T12:00:00.000Z'
		};
		await tripApi.create(body);
		expect(post).toHaveBeenCalledWith('/api/v1/trips', body);
	});

	test('update PUTs to /api/v1/trips/:id', async () => {
		put.mockResolvedValueOnce(TRIP);
		await tripApi.update('t1', { note: 'updated' });
		expect(put).toHaveBeenCalledWith('/api/v1/trips/t1', { note: 'updated' });
	});

	test('delete DELETEs /api/v1/trips/:id', async () => {
		del.mockResolvedValueOnce(undefined);
		await tripApi.delete('t1');
		expect(del).toHaveBeenCalledWith('/api/v1/trips/t1');
	});
});

describe('tripDistance (FE derived, mirrors the backend clamp)', () => {
	test('returns driven miles for a normal pair', () => {
		expect(tripDistance({ startOdometer: 1000, endOdometer: 1080 })).toBe(80);
	});

	test('clamps a non-increasing pair to 0 (R2/#46)', () => {
		expect(tripDistance({ startOdometer: 1080, endOdometer: 1000 })).toBe(0);
		expect(tripDistance({ startOdometer: 500, endOdometer: 500 })).toBe(0);
	});
});
