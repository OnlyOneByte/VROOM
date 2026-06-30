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
import { ApiError } from '$lib/utils/error-handling';

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

	test('vehicleId + a non-zero rate are serialized', async () => {
		get.mockResolvedValueOnce(SUMMARY);
		await tripApi.getSummary({ vehicleId: 'v1', rate: 0.67 });
		const url = get.mock.calls[0]?.[0] as string;
		expect(url).toContain('/api/v1/trips/summary?');
		expect(url).toContain('vehicleId=v1');
		expect(url).toContain('rate=0.67');
	});

	// C219 (guard): rate=0 is a MEANINGFUL business value (explicit free reimbursement / "no rate"), NOT an
	// absent param — it must SURVIVE serialization, unlike an empty-string vehicleId which is dropped. The
	// trip-api passes `rate: params.rate` raw (no `|| undefined` coercion that would nuke a 0), relying on
	// buildQueryString's `value != null` check (drops only null/undefined, keeps a numeric 0). A C219
	// bug-scout verified this firsthand; this pins it so a future `rate || undefined` refactor (the
	// reminder-api isActive:false truthy-drop class) can't silently swallow an explicit-zero rate.
	test('rate=0 SURVIVES (a meaningful explicit-zero, not a dropped falsy)', async () => {
		get.mockResolvedValueOnce(SUMMARY);
		await tripApi.getSummary({ rate: 0 });
		const url = get.mock.calls[0]?.[0] as string;
		expect(url, `url was: ${url}`).toContain('rate=0');
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

// C238 deep-review cert: trip-api wrappers are thin passthroughs with NO try/catch — an apiClient ApiError
// (non-2xx) must PROPAGATE to the caller, NOT be swallowed into a resolved empty value. The whole FE error
// discipline downstream depends on this: the /trips list page's `loadError` four-state (it shows the error
// pane, NOT the "No trips yet" empty state, on a fetch failure — the masquerade-as-data-loss guard) and the
// TripForm's catch→"Failed to log trip" toast both assume a rejected promise. The wiring tests above only
// cover the resolved path; nothing pinned that a server error reaches the caller. If a future refactor added
// a swallow-and-return-[] to trip-api, the list page would silently render "No trips yet" on a 500 with NO
// failing test. These pin the propagation across the read + both mutate verbs (the reminder-api/expense-api
// rejects.toThrow pattern). Vacuity floor: each asserts the SAME ApiError instance/message escapes.
describe('tripApi propagates apiClient errors (does not swallow — the loadError/toast contract)', () => {
	test('list rejects when getPaginated throws (→ the list page error pane, not empty state)', async () => {
		getPaginated.mockRejectedValueOnce(new ApiError('Server unavailable', 503));
		await expect(tripApi.list()).rejects.toThrow('Server unavailable');
	});

	test('getSummary rejects when get throws (→ the summary card does not silently zero)', async () => {
		get.mockRejectedValueOnce(new ApiError('Server error', 500));
		await expect(tripApi.getSummary()).rejects.toThrow('Server error');
	});

	test('create rejects when post throws (→ the TripForm catch fires its failure toast)', async () => {
		post.mockRejectedValueOnce(new ApiError('Validation failed', 400));
		await expect(
			tripApi.create({
				vehicleId: 'v1',
				startOdometer: 1000,
				endOdometer: 1080,
				purpose: 'business',
				tripDate: '2024-06-20T12:00:00.000Z'
			})
		).rejects.toThrow('Validation failed');
	});

	test('delete rejects when delete throws (→ a failed delete is not silently treated as success)', async () => {
		del.mockRejectedValueOnce(new ApiError('Trip not found', 404));
		await expect(tripApi.delete('nope')).rejects.toThrow('Trip not found');
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
