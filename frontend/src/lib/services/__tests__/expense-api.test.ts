/**
 * Coverage ratchet (guard, C149) for expense-api.ts — the C124-named FE low spot. `buildExpenseQuery`
 * is already pinned (build-expense-query.test.ts); this covers the uncovered LAYER: the method→endpoint
 * wiring + the backend↔frontend transform (fromBackendExpense / toBackendExpense) those methods drive,
 * the getPaginated envelope passthrough, and the downloadExpensesCsv blob→anchor DOM dance.
 *
 * apiClient is mocked (the api-client/reminder-api pattern) so we assert the exact URL + payload each
 * method builds AND that the real transformer ran on the way in/out. The transformer itself is exercised
 * here end-to-end through the public methods (its own field-mapping is the load-bearing contract).
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { BackendExpenseResponse } from '../api-transformer';

const get = vi.fn();
const post = vi.fn();
const put = vi.fn();
const del = vi.fn();
const getPaginated = vi.fn();
const raw = vi.fn();
vi.mock('../api-client', () => ({
	apiClient: { get, post, put, delete: del, getPaginated, raw },
	getApiBaseUrl: () => '',
	withPagination: (url: string) => url
}));

const { expenseApi } = await import('../expense-api');

/** A backend expense row (snake of the API contract) for the transform assertions. */
function backendExpense(over: Partial<BackendExpenseResponse> = {}): BackendExpenseResponse {
	return {
		id: 'e1',
		vehicleId: 'v1',
		userId: 'u1',
		tags: [],
		category: 'fuel',
		expenseAmount: 42.5,
		date: '2024-01-15',
		createdAt: '2024-01-15T00:00:00.000Z',
		updatedAt: '2024-01-15T00:00:00.000Z',
		...over
	};
}

beforeEach(() => {
	for (const fn of [get, post, put, del, getPaginated, raw]) fn.mockReset();
});
afterEach(() => vi.clearAllMocks());

describe('getExpense (backend→frontend transform)', () => {
	test('maps expenseAmount→amount and GETs the id path', async () => {
		get.mockResolvedValueOnce(backendExpense({ expenseAmount: 99.9 }));
		const result = await expenseApi.getExpense('e1');
		expect(get).toHaveBeenCalledWith('/api/v1/expenses/e1');
		expect(result.amount).toBe(99.9);
		expect(result.id).toBe('e1');
	});

	test('a gas expense maps backend volume→frontend volume (not charge)', async () => {
		get.mockResolvedValueOnce(backendExpense({ fuelType: '87 (Regular)', volume: 12 }));
		const result = await expenseApi.getExpense('e1');
		expect(result.volume).toBe(12);
		expect(result.charge).toBeUndefined();
	});

	test('an electric expense maps backend volume→frontend charge (not volume)', async () => {
		get.mockResolvedValueOnce(backendExpense({ fuelType: 'Electric', volume: 40 }));
		const result = await expenseApi.getExpense('e1');
		expect(result.charge).toBe(40);
		expect(result.volume).toBeUndefined();
	});
});

describe('list methods (getPaginated passthrough + per-row transform)', () => {
	test('getAllExpenses transforms each row and preserves pagination metadata', async () => {
		getPaginated.mockResolvedValueOnce({
			data: [backendExpense({ id: 'e1', expenseAmount: 10 }), backendExpense({ id: 'e2', expenseAmount: 20 })],
			pagination: { totalCount: 2, limit: 20, offset: 0, hasMore: false }
		});
		const result = await expenseApi.getAllExpenses({ limit: 20 });
		expect(getPaginated).toHaveBeenCalledWith('/api/v1/expenses?limit=20');
		expect(result.data.map((e) => e.amount)).toEqual([10, 20]);
		expect(result.pagination.totalCount).toBe(2);
	});

	test('getExpensesByVehicle sets vehicleId in the query', async () => {
		getPaginated.mockResolvedValueOnce({
			data: [],
			pagination: { totalCount: 0, limit: 20, offset: 0, hasMore: false }
		});
		await expenseApi.getExpensesByVehicle('v1', { limit: 20 });
		const url = getPaginated.mock.calls[0]?.[0] as string;
		expect(url).toContain('vehicleId=v1');
		expect(url).toContain('limit=20');
	});
});

describe('createExpense / updateExpense (frontend→backend transform + isEdit)', () => {
	test('createExpense maps amount→expenseAmount and POSTs', async () => {
		post.mockResolvedValueOnce(backendExpense({ expenseAmount: 50 }));
		await expenseApi.createExpense({ vehicleId: 'v1', category: 'fuel', amount: 50 });
		const [url, body] = post.mock.calls[0] ?? [];
		expect(url).toBe('/api/v1/expenses');
		expect((body as { expenseAmount: number }).expenseAmount).toBe(50);
	});

	test('createExpense OMITS an empty description (create payload unchanged)', async () => {
		post.mockResolvedValueOnce(backendExpense());
		await expenseApi.createExpense({ vehicleId: 'v1', category: 'fuel', amount: 50, description: '' });
		const body = post.mock.calls[0]?.[1] as Record<string, unknown>;
		expect('description' in body).toBe(false);
	});

	test('updateExpense sends an emptied description as null (the clear-field class)', async () => {
		put.mockResolvedValueOnce(backendExpense());
		await expenseApi.updateExpense('e1', { vehicleId: 'v1', category: 'fuel', amount: 50, description: '' });
		const [url, body] = put.mock.calls[0] ?? [];
		expect(url).toBe('/api/v1/expenses/e1');
		expect((body as { description: string | null }).description).toBeNull();
	});
});

describe('downloadExpensesCsv (blob → anchor download)', () => {
	test('throws on a non-ok export response', async () => {
		raw.mockResolvedValueOnce({ ok: false, status: 500 });
		await expect(expenseApi.downloadExpensesCsv()).rejects.toThrow(/Export failed with status 500/);
	});

	test('on success: fetches the export URL with filters, blobs, and clicks a download anchor', async () => {
		const click = vi.fn();
		const realCreate = document.createElement.bind(document);
		const createSpy = vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
			const el = realCreate(tag);
			if (tag === 'a') el.click = click; // stub only the anchor's click
			return el;
		});
		vi.spyOn(document.body, 'appendChild').mockImplementation((n) => n);
		vi.spyOn(document.body, 'removeChild').mockImplementation((n) => n);
		// jsdom lacks URL.createObjectURL / revokeObjectURL — stub them.
		(window.URL.createObjectURL as unknown) = vi.fn(() => 'blob:x');
		(window.URL.revokeObjectURL as unknown) = vi.fn();
		raw.mockResolvedValueOnce({ ok: true, status: 200, blob: () => Promise.resolve(new Blob(['csv'])) });

		await expenseApi.downloadExpensesCsv({ vehicleId: 'v1', tags: ['a', 'b'] });

		const exportUrl = raw.mock.calls[0]?.[0] as string;
		expect(exportUrl).toContain('/api/v1/expenses/export');
		expect(exportUrl).toContain('vehicleId=v1');
		expect(exportUrl).toContain('tags=a%2Cb'); // tags comma-joined for the export schema
		expect(click).toHaveBeenCalledTimes(1);
		createSpy.mockRestore();
	});
});

describe('split + delete endpoint wiring', () => {
	test('deleteExpense DELETEs the id path', async () => {
		del.mockResolvedValueOnce(undefined);
		await expenseApi.deleteExpense('e1');
		expect(del).toHaveBeenCalledWith('/api/v1/expenses/e1');
	});

	test('createSplitExpense POSTs to the split endpoint with the config', async () => {
		post.mockResolvedValueOnce({ siblings: [], groupId: 'g1', groupTotal: 100, splitMethod: 'even' });
		await expenseApi.createSplitExpense({
			splitConfig: { method: 'even', vehicleIds: ['v1', 'v2'] },
			category: 'fuel',
			date: '2024-01-15',
			totalAmount: 100
		});
		const [url, body] = post.mock.calls[0] ?? [];
		expect(url).toBe('/api/v1/expenses/split');
		expect((body as { totalAmount: number }).totalAmount).toBe(100);
	});

	test('deleteSplitExpense DELETEs the split group path', async () => {
		del.mockResolvedValueOnce(undefined);
		await expenseApi.deleteSplitExpense('g1');
		expect(del).toHaveBeenCalledWith('/api/v1/expenses/split/g1');
	});
});
