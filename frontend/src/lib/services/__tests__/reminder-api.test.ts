import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Expense, RecurringCostSummary } from '$lib/types';
import { ApiError } from '$lib/utils/error-handling';

// Mock apiClient (the analytics-api.test.ts pattern) — apiClient.get already unwraps the
// { success, data } envelope, so these thin wrappers should return `data` verbatim.
vi.mock('../api-client', () => ({
	apiClient: {
		get: vi.fn()
	}
}));

const { apiClient } = await import('../api-client');
const { reminderApi } = await import('../reminder-api');

const mockGet = vi.mocked(apiClient.get);

const mockMaterialized: Expense[] = [
	{
		id: 'e1',
		vehicleId: 'v1',
		userId: 'u1',
		tags: [],
		category: 'maintenance',
		amount: 49.99,
		date: '2024-01-15',
		sourceType: 'reminder',
		sourceId: 'r1',
		createdAt: '2024-01-15T00:00:00.000Z',
		updatedAt: '2024-01-15T00:00:00.000Z'
	}
];

const mockSummary: RecurringCostSummary = { count: 3, monthlyTotal: 142.5 };

describe('reminderApi.getMaterializedExpenses() (T6 seam)', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('GETs the per-reminder expenses path with the id interpolated, returns the rows', async () => {
		mockGet.mockResolvedValueOnce(mockMaterialized);

		const result = await reminderApi.getMaterializedExpenses('r1');

		expect(mockGet).toHaveBeenCalledTimes(1);
		// Exact path — guards against a future wrong-segment typo (e.g. /expenses/:id).
		expect(mockGet).toHaveBeenCalledWith('/api/v1/reminders/r1/expenses');
		expect(result).toEqual(mockMaterialized);
		// The source link the T6 badge reads must survive the wrapper untouched.
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

describe('reminderApi.getRecurringCost() (T7 seam)', () => {
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
