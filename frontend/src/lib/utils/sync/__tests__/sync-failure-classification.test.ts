import { beforeEach, describe, expect, it, vi } from 'vitest';
import { onlineStatus, syncState } from '../../../stores/offline.svelte';
import { ApiError } from '../../error-handling';
import {
	loadOfflineExpenses,
	type OfflineExpense,
	saveOfflineExpenses
} from '../../offline-storage';
import { classifySyncFailure, syncConfig, syncManager } from '../sync-manager';

const mockFetch = vi.fn();
global.fetch = mockFetch;

function apiOk(data: unknown = { id: 'server-1' }): Response {
	return new Response(JSON.stringify({ success: true, data }), {
		status: 200,
		headers: { 'content-type': 'application/json' }
	});
}

function apiError(status: number, message: string): Response {
	return new Response(JSON.stringify({ error: { message } }), {
		status,
		headers: { 'content-type': 'application/json' }
	});
}

function postFailsWith(status: number, message = 'nope'): void {
	mockFetch.mockImplementation((_url: string, init?: { method?: string }) => {
		const method = init?.method ?? 'GET';
		if (method === 'GET') return Promise.resolve(apiOk([]));
		return Promise.resolve(apiError(status, message));
	});
}

const ls = (global as unknown as { localStorageMock: { clear: () => void } }).localStorageMock;

function pending(id: string): OfflineExpense {
	return {
		id,
		clientId: `cid-${id}`,
		vehicleId: 'v1',
		tags: ['misc'],
		category: 'misc',
		amount: 12.34,
		date: '2024-06-01',
		timestamp: Date.now(),
		synced: false,
		version: '3.0'
	};
}

const RETRY_DELAYS = new Set([100, 200, 400, 800]);

function retryWasScheduled(spy: { mock: { calls: unknown[][] } }): boolean {
	return spy.mock.calls.some(call => {
		const delay = call[1];
		return typeof delay === 'number' && RETRY_DELAYS.has(delay);
	});
}

describe('classifySyncFailure', () => {
	it('maps a server verdict to terminal and a recoverable failure to transient', () => {
		expect(classifySyncFailure(new ApiError('bad request', 400))).toBe('terminal');
		expect(classifySyncFailure(new ApiError('vehicle not found', 404))).toBe('terminal');
		expect(classifySyncFailure(new ApiError('forbidden', 403))).toBe('terminal');
		expect(classifySyncFailure(new ApiError('conflict', 409))).toBe('terminal');
		expect(classifySyncFailure(new ApiError('unprocessable', 422))).toBe('terminal');

		expect(classifySyncFailure(new ApiError('session expired', 401))).toBe('auth');

		expect(classifySyncFailure(new ApiError('timeout', 408))).toBe('transient');
		expect(classifySyncFailure(new ApiError('slow down', 429))).toBe('transient');
		expect(classifySyncFailure(new ApiError('boom', 500))).toBe('transient');
		expect(classifySyncFailure(new ApiError('gateway', 502))).toBe('transient');
		expect(classifySyncFailure(new TypeError('Failed to fetch'))).toBe('transient');
		expect(classifySyncFailure('not even an error')).toBe('transient');
	});
});

describe('SyncManager.syncAll — HTTP failure classification', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		ls.clear();
		syncState.current = 'idle';
		onlineStatus.current = true;
		syncConfig.current = {
			maxRetries: 3,
			retryDelay: 100,
			batchSize: 10,
			conflictResolution: 'ask_user'
		};
	});

	it('parks a 400-rejected row instead of retrying it forever', async () => {
		saveOfflineExpenses([pending('rejected')]);
		postFailsWith(400, 'amount must be positive');

		vi.useFakeTimers();
		const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
		try {
			const result = await syncManager.syncAll();

			expect(result.needsAttention).toBe(1);
			expect(result.failed).toBe(0);
			expect(result.errors).toContain('amount must be positive');
			expect(loadOfflineExpenses()[0]?.needsAttention).toBe(true);
			expect(loadOfflineExpenses()[0]?.attentionReason).toBe('amount must be positive');
			expect(syncManager.getRetryCount('rejected')).toBe(0);
			expect(retryWasScheduled(setTimeoutSpy)).toBe(false);
		} finally {
			setTimeoutSpy.mockRestore();
			vi.useRealTimers();
		}
	});

	it('parks a 404-rejected row (the deleted-vehicle case) and never re-POSTs it', async () => {
		saveOfflineExpenses([pending('gone')]);
		postFailsWith(404, 'Vehicle not found');

		vi.useFakeTimers();
		try {
			await syncManager.syncAll();
			expect(loadOfflineExpenses()[0]?.needsAttention).toBe(true);

			mockFetch.mockClear();
			const second = await syncManager.syncAll();
			expect(mockFetch).not.toHaveBeenCalled();
			expect(second.needsAttention).toBe(0);
		} finally {
			vi.useRealTimers();
		}
	});

	it('keeps a 500-failed row pending WITH a retry (a server fault can still resolve)', async () => {
		saveOfflineExpenses([pending('flaky')]);
		postFailsWith(500, 'Server Error');

		vi.useFakeTimers();
		const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
		try {
			const result = await syncManager.syncAll();

			expect(result.failed).toBe(1);
			expect(result.needsAttention).toBe(0);
			expect(loadOfflineExpenses()[0]?.needsAttention).toBeUndefined();
			expect(syncManager.getRetryCount('flaky')).toBe(1);
			expect(retryWasScheduled(setTimeoutSpy)).toBe(true);
		} finally {
			setTimeoutSpy.mockRestore();
			vi.useRealTimers();
		}
	});

	it('a 429 is transient, not a verdict: the row is kept pending, not parked', async () => {
		saveOfflineExpenses([pending('throttled')]);
		postFailsWith(429, 'Too many requests');

		vi.useFakeTimers();
		try {
			const result = await syncManager.syncAll();

			expect(result.needsAttention).toBe(0);
			expect(result.failed).toBe(1);
			expect(loadOfflineExpenses()[0]?.needsAttention).toBeUndefined();
		} finally {
			vi.useRealTimers();
		}
	});

	it('a 401 leaves the row pending, unparked, and does not burn a retry', async () => {
		saveOfflineExpenses([pending('signedout')]);
		postFailsWith(401, 'Session expired');

		vi.useFakeTimers();
		const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
		try {
			const result = await syncManager.syncAll();

			expect(result.failed).toBe(1);
			expect(result.needsAttention).toBe(0);
			const [row] = loadOfflineExpenses();
			expect(row?.synced).toBe(false);
			expect(row?.needsAttention).toBeUndefined();
			expect(syncManager.getRetryCount('signedout')).toBe(0);
			expect(retryWasScheduled(setTimeoutSpy)).toBe(false);
		} finally {
			setTimeoutSpy.mockRestore();
			vi.useRealTimers();
		}
	});
});
