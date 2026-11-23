import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { BackendExpenseResponse } from '#lib/types/index.ts';

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
		expect(get).toHaveBeenCalledWith('/expenses/e1');
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
			data: [
				backendExpense({ id: 'e1', expenseAmount: 10 }),
				backendExpense({ id: 'e2', expenseAmount: 20 })
			],
			pagination: { totalCount: 2, limit: 20, offset: 0, hasMore: false }
		});
		const result = await expenseApi.getAllExpenses({ limit: 20 });
		expect(getPaginated).toHaveBeenCalledWith('/expenses?limit=20');
		expect(result.data.map(e => e.amount)).toEqual([10, 20]);
		expect(result.pagination.totalCount).toBe(2);
	});

	test('getAllExpenses sends a vehicleId filter to the server', async () => {
		getPaginated.mockResolvedValueOnce({
			data: [],
			pagination: { totalCount: 0, limit: 20, offset: 0, hasMore: false }
		});
		await expenseApi.getAllExpenses({ vehicleId: 'v2', limit: 20 });
		expect(getPaginated).toHaveBeenCalledWith('/expenses?vehicleId=v2&limit=20');
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

	test('a date range sends the user time zone so the backend filters on their calendar days', async () => {
		getPaginated.mockResolvedValueOnce({
			data: [],
			pagination: { totalCount: 0, limit: 20, offset: 0, hasMore: false }
		});
		await expenseApi.getAllExpenses({ startDate: '2026-03-01', endDate: '2026-03-31' });
		const url = getPaginated.mock.calls[0]?.[0] as string;
		const zone = encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone);
		expect(url).toContain(`endDate=2026-03-31&timeZone=${zone}`);
	});
});

describe('createExpense / updateExpense (frontend→backend transform + isEdit)', () => {
	test('createExpense maps amount→expenseAmount and POSTs', async () => {
		post.mockResolvedValueOnce(backendExpense({ expenseAmount: 50 }));
		await expenseApi.createExpense({ vehicleId: 'v1', category: 'fuel', amount: 50 });
		const [url, body] = post.mock.calls[0] ?? [];
		expect(url).toBe('/expenses');
		expect((body as { expenseAmount: number }).expenseAmount).toBe(50);
	});

	test('createExpense OMITS an empty description (create payload unchanged)', async () => {
		post.mockResolvedValueOnce(backendExpense());
		await expenseApi.createExpense({
			vehicleId: 'v1',
			category: 'fuel',
			amount: 50,
			description: ''
		});
		const body = post.mock.calls[0]?.[1] as Record<string, unknown>;
		expect('description' in body).toBe(false);
	});

	test('updateExpense sends an emptied description as null (the clear-field class)', async () => {
		put.mockResolvedValueOnce(backendExpense());
		await expenseApi.updateExpense('e1', {
			vehicleId: 'v1',
			category: 'fuel',
			amount: 50,
			description: ''
		});
		const [url, body] = put.mock.calls[0] ?? [];
		expect(url).toBe('/expenses/e1');
		expect((body as { description: string | null }).description).toBeNull();
	});

	test('create and update send the user time zone so the odometer check compares their days', async () => {
		post.mockResolvedValueOnce(backendExpense());
		put.mockResolvedValueOnce(backendExpense());
		const expense = { vehicleId: 'v1', category: 'fuel' as const, amount: 50 };
		await expenseApi.createExpense(expense);
		await expenseApi.updateExpense('e1', expense);
		const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
		expect(post.mock.calls[0]?.[1]).toMatchObject({ timeZone: zone });
		expect(put.mock.calls[0]?.[1]).toMatchObject({ timeZone: zone });
	});
});

describe('downloadExpensesCsv (blob → anchor download)', () => {
	test('propagates the apiClient error for a failed export', async () => {
		const failure = new Error('Request failed with status 500');
		raw.mockRejectedValueOnce(failure);
		await expect(expenseApi.downloadExpensesCsv()).rejects.toBe(failure);
	});

	test('no filters → bare export path', async () => {
		raw.mockRejectedValueOnce(new Error('stop'));
		await expect(expenseApi.downloadExpensesCsv()).rejects.toThrow('stop');
		expect(raw).toHaveBeenCalledWith('/expenses/export');
	});

	test('on success: fetches the export URL with filters, blobs, and clicks a download anchor', async () => {
		const click = vi.fn();
		const realCreate = document.createElement.bind(document);
		const createSpy = vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
			const el = realCreate(tag);
			if (tag === 'a') el.click = click;
			return el;
		});
		vi.spyOn(document.body, 'appendChild').mockImplementation(n => n);
		vi.spyOn(document.body, 'removeChild').mockImplementation(n => n);
		(window.URL.createObjectURL as unknown) = vi.fn(() => 'blob:x');
		(window.URL.revokeObjectURL as unknown) = vi.fn();
		raw.mockResolvedValueOnce({
			ok: true,
			status: 200,
			blob: () => Promise.resolve(new Blob(['csv']))
		});

		await expenseApi.downloadExpensesCsv({ vehicleId: 'v1', tags: ['a', 'b'] });

		const exportUrl = raw.mock.calls[0]?.[0] as string;
		expect(exportUrl).toContain('/expenses/export');
		expect(exportUrl).toContain('vehicleId=v1');
		expect(exportUrl).toContain('tags=a%2Cb');
		expect(click).toHaveBeenCalledTimes(1);
		createSpy.mockRestore();
	});
});

describe('split + delete endpoint wiring', () => {
	test('deleteExpense DELETEs the id path', async () => {
		del.mockResolvedValueOnce(undefined);
		await expenseApi.deleteExpense('e1');
		expect(del).toHaveBeenCalledWith('/expenses/e1');
	});

	test('createSplitExpense POSTs to the split endpoint with the config', async () => {
		post.mockResolvedValueOnce({
			siblings: [],
			groupId: 'g1',
			groupTotal: 100,
			splitMethod: 'even'
		});
		await expenseApi.createSplitExpense({
			splitConfig: { method: 'even', vehicleIds: ['v1', 'v2'] },
			category: 'fuel',
			date: '2024-01-15',
			totalAmount: 100
		});
		const [url, body] = post.mock.calls[0] ?? [];
		expect(url).toBe('/expenses/split');
		expect((body as { totalAmount: number }).totalAmount).toBe(100);
	});

	test('deleteSplitExpense DELETEs the split group path', async () => {
		del.mockResolvedValueOnce(undefined);
		await expenseApi.deleteSplitExpense('g1');
		expect(del).toHaveBeenCalledWith('/expenses/split/g1');
	});
});

describe('expenseApi query and photo wiring', () => {
	test('detectImportSource POSTs the file sample and returns the detected format', async () => {
		post.mockResolvedValueOnce(null);
		await expect(expenseApi.detectImportSource('Date,Amount\n')).resolves.toBeNull();
		expect(post).toHaveBeenCalledWith('/expenses/import/detect', {
			sample: 'Date,Amount\n'
		});
	});

	test('getExpenseSummary omits empty filters, encodes provided ones and sends the time zone', async () => {
		get.mockResolvedValue({});
		const zone = encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone);
		await expenseApi.getExpenseSummary();
		await expenseApi.getExpenseSummary({ vehicleId: '', period: '' });
		await expenseApi.getExpenseSummary({ vehicleId: 'v1', period: '30d' });
		expect(get.mock.calls.map(c => c[0])).toEqual([
			`/expenses/summary?timeZone=${zone}`,
			`/expenses/summary?timeZone=${zone}`,
			`/expenses/summary?vehicleId=v1&period=30d&timeZone=${zone}`
		]);
	});

	test('getVehicleStats only sends recentDays when it is positive', async () => {
		get.mockResolvedValue([]);
		await expenseApi.getVehicleStats();
		await expenseApi.getVehicleStats(0);
		await expenseApi.getVehicleStats(30);
		expect(get.mock.calls.map(c => c[0])).toEqual([
			'/expenses/vehicle-stats',
			'/expenses/vehicle-stats',
			'/expenses/vehicle-stats?recentDays=30'
		]);
	});

	test('photo helpers target the expense entity photo collection', async () => {
		getPaginated.mockResolvedValueOnce({ data: [] });
		del.mockResolvedValueOnce(undefined);
		await expenseApi.getPhotos('expense', 'e1');
		await expenseApi.deletePhoto('expense', 'e1', 'p1');
		expect(getPaginated).toHaveBeenCalledWith('/photos/expense/e1');
		expect(del).toHaveBeenCalledWith('/photos/expense/e1/p1');
		expect(expenseApi.getPhotoThumbnailUrl('expense', 'e1', 'p1')).toBe(
			'/photos/expense/e1/p1/thumbnail'
		);
	});

	test('updateSplitExpense PUTs the new config to the group path', async () => {
		put.mockResolvedValueOnce({ siblings: [], groupId: 'g1', groupTotal: 50, splitMethod: 'even' });
		await expenseApi.updateSplitExpense('g1', {
			splitConfig: { method: 'even', vehicleIds: ['v1', 'v2'] },
			totalAmount: 50
		});
		expect(put).toHaveBeenCalledWith('/expenses/split/g1', {
			splitConfig: { method: 'even', vehicleIds: ['v1', 'v2'] },
			totalAmount: 50
		});
	});

	test('getSplitExpense GETs the group and propagates failures', async () => {
		get.mockResolvedValueOnce({ siblings: [], groupId: 'g2', groupTotal: 0, splitMethod: 'even' });
		await expect(expenseApi.getSplitExpense('g2')).resolves.toMatchObject({ groupId: 'g2' });
		expect(get).toHaveBeenCalledWith('/expenses/split/g2');
		get.mockRejectedValueOnce(new Error('gone'));
		await expect(expenseApi.getSplitExpense('g3')).rejects.toThrow('gone');
	});
});
