import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { BackendExpenseResponse, RecurringCostSummary } from '$lib/types';
import { ApiError } from '$lib/utils/error-handling';

vi.mock('../api-client', () => ({
	apiClient: {
		get: vi.fn(),
		post: vi.fn(),
		put: vi.fn(),
		delete: vi.fn()
	}
}));

const { apiClient } = await import('../api-client');
const { reminderApi } = await import('../reminder-api');

const mockGet = vi.mocked(apiClient.get);
const mockPost = vi.mocked(apiClient.post);
const mockPut = vi.mocked(apiClient.put);
const mockDelete = vi.mocked(apiClient.delete);

const mockMaterialized: BackendExpenseResponse[] = [
	{
		id: 'e1',
		vehicleId: 'v1',
		userId: 'u1',
		tags: [],
		category: 'maintenance',
		expenseAmount: 49.99,
		date: '2024-01-15',
		sourceType: 'reminder',
		sourceId: 'r1',
		createdAt: '2024-01-15T00:00:00.000Z',
		updatedAt: '2024-01-15T00:00:00.000Z'
	},
	{
		id: 'e2',
		vehicleId: 'v1',
		userId: 'u1',
		tags: [],
		category: 'fuel',
		expenseAmount: 12.5,
		volume: 30,
		fuelType: 'Level 2 (AC)',
		date: '2024-02-01',
		sourceType: 'reminder',
		sourceId: 'r1',
		createdAt: '2024-02-01T00:00:00.000Z',
		updatedAt: '2024-02-01T00:00:00.000Z'
	}
];

const mockSummary: RecurringCostSummary = { count: 3, monthlyTotal: 142.5 };

describe('reminderApi.getMaterializedExpenses()', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('GETs the per-reminder expenses path with the id interpolated, mapping backend→frontend shape', async () => {
		mockGet.mockResolvedValueOnce(mockMaterialized);

		const result = await reminderApi.getMaterializedExpenses('r1');

		expect(mockGet).toHaveBeenCalledTimes(1);
		expect(mockGet).toHaveBeenCalledWith('/api/v1/reminders/r1/expenses');
		expect(result[0]?.amount).toBe(49.99);
		expect(result[0]).not.toHaveProperty('expenseAmount');
		expect(result[1]?.charge).toBe(30);
		expect(result[1]?.volume).toBeUndefined();
		expect(result[0]?.sourceType).toBe('reminder');
		expect(result[0]?.sourceId).toBe('r1');
	});

	it('returns the empty array for a reminder that materialized nothing', async () => {
		mockGet.mockResolvedValueOnce([]);
		await expect(reminderApi.getMaterializedExpenses('r9')).resolves.toEqual([]);
		expect(mockGet).toHaveBeenCalledWith('/api/v1/reminders/r9/expenses');
	});

	it('propagates a 404 (reminder not owned / missing) rather than swallowing it', async () => {
		mockGet.mockRejectedValueOnce(new ApiError('Reminder not found', 404));
		await expect(reminderApi.getMaterializedExpenses('nope')).rejects.toThrow('Reminder not found');
	});
});

describe('reminderApi.getRecurringCost()', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('GETs the static recurring-cost path and returns the {count, monthlyTotal} summary', async () => {
		mockGet.mockResolvedValueOnce(mockSummary);

		const result = await reminderApi.getRecurringCost();

		expect(mockGet).toHaveBeenCalledTimes(1);
		expect(mockGet).toHaveBeenCalledWith('/api/v1/reminders/recurring-cost');
		expect(result).toEqual(mockSummary);
		expect(result.count).toBe(3);
		expect(result.monthlyTotal).toBe(142.5);
	});

	it('passes through the empty zero-summary (no active expense reminders)', async () => {
		mockGet.mockResolvedValueOnce({ count: 0, monthlyTotal: 0 });
		await expect(reminderApi.getRecurringCost()).resolves.toEqual({ count: 0, monthlyTotal: 0 });
	});

	it('propagates an API error rather than returning a partial', async () => {
		mockGet.mockRejectedValueOnce(new ApiError('Server unavailable', 503));
		await expect(reminderApi.getRecurringCost()).rejects.toThrow('Server unavailable');
	});
});

describe('reminderApi — CRUD + trigger + mark-serviced wiring', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('create POSTs /reminders with the body', async () => {
		mockPost.mockResolvedValueOnce({ reminder: { id: 'r1' }, vehicleIds: ['v1'] });
		const body = { title: 'Oil change', vehicleIds: ['v1'] };
		await reminderApi.create(body);
		expect(mockPost).toHaveBeenCalledWith('/api/v1/reminders', body);
	});

	it('getById GETs the id path', async () => {
		mockGet.mockResolvedValueOnce({ reminder: { id: 'r1' }, vehicleIds: [] });
		await reminderApi.getById('r1');
		expect(mockGet).toHaveBeenCalledWith('/api/v1/reminders/r1');
	});

	it('update PUTs the id path with the body', async () => {
		mockPut.mockResolvedValueOnce({ reminder: { id: 'r1' }, vehicleIds: ['v2'] });
		const body = { title: 'New', vehicleIds: ['v2'] };
		await reminderApi.update('r1', body);
		expect(mockPut).toHaveBeenCalledWith('/api/v1/reminders/r1', body);
	});

	it('delete DELETEs the id path', async () => {
		mockDelete.mockResolvedValueOnce(undefined);
		await reminderApi.delete('r1');
		expect(mockDelete).toHaveBeenCalledWith('/api/v1/reminders/r1');
	});

	it('trigger POSTs /reminders/trigger', async () => {
		mockPost.mockResolvedValueOnce({ createdExpenses: [], notifications: [], skipped: [] });
		await reminderApi.trigger();
		expect(mockPost).toHaveBeenCalledWith('/api/v1/reminders/trigger');
	});

	it('markServiced POSTs the mark-serviced path', async () => {
		mockPost.mockResolvedValueOnce({ id: 'r1' });
		await reminderApi.markServiced('r1');
		expect(mockPost).toHaveBeenCalledWith('/api/v1/reminders/r1/mark-serviced');
	});

	it('markNotificationRead PUTs the notification read path', async () => {
		mockPut.mockResolvedValueOnce({ id: 'n1', isRead: true });
		await reminderApi.markNotificationRead('n1');
		expect(mockPut).toHaveBeenCalledWith('/api/v1/reminders/notifications/n1/read');
	});
});

describe('reminderApi.list — buildReminderQuery filter construction', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('no filters → bare /reminders (no query string)', async () => {
		mockGet.mockResolvedValueOnce([]);
		await reminderApi.list();
		expect(mockGet).toHaveBeenCalledWith('/api/v1/reminders');
	});

	it('empty filters object → still bare (no keys set)', async () => {
		mockGet.mockResolvedValueOnce([]);
		await reminderApi.list({});
		expect(mockGet).toHaveBeenCalledWith('/api/v1/reminders');
	});

	it('vehicleId + type are appended as query params', async () => {
		mockGet.mockResolvedValueOnce([]);
		await reminderApi.list({ vehicleId: 'v1', type: 'expense' });
		expect(mockGet).toHaveBeenCalledWith('/api/v1/reminders?vehicleId=v1&type=expense');
	});

	it('isActive=false MUST survive (the !== undefined edge, not a truthiness check)', async () => {
		mockGet.mockResolvedValueOnce([]);
		await reminderApi.list({ isActive: false });
		expect(mockGet).toHaveBeenCalledWith('/api/v1/reminders?isActive=false');
	});

	it('isActive=true is serialized as the string "true"', async () => {
		mockGet.mockResolvedValueOnce([]);
		await reminderApi.list({ isActive: true });
		expect(mockGet).toHaveBeenCalledWith('/api/v1/reminders?isActive=true');
	});
});

describe('reminderApi.getNotifications — unreadOnly gating', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('no arg → bare notifications path', async () => {
		mockGet.mockResolvedValueOnce([]);
		await reminderApi.getNotifications();
		expect(mockGet).toHaveBeenCalledWith('/api/v1/reminders/notifications');
	});

	it('unreadOnly=true → ?unreadOnly=true', async () => {
		mockGet.mockResolvedValueOnce([]);
		await reminderApi.getNotifications(true);
		expect(mockGet).toHaveBeenCalledWith('/api/v1/reminders/notifications?unreadOnly=true');
	});

	it('unreadOnly=false → bare path (falsy → no query)', async () => {
		mockGet.mockResolvedValueOnce([]);
		await reminderApi.getNotifications(false);
		expect(mockGet).toHaveBeenCalledWith('/api/v1/reminders/notifications');
	});
});
