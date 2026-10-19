/**
 * A failed offline-expense POST must be classified before it is queued or retried, because the three
 * kinds of failure need opposite handling:
 *
 *  - a 4xx VERDICT (400 validation, 404 deleted vehicle, 403 revoked share) will be returned
 *    identically on every attempt, so retrying it is an unbounded loop that can never deliver the
 *    row. It is parked as needs-attention and surfaced, exactly like a structurally-malformed row.
 *  - a 5xx / transport failure can succeed later, so it keeps its retry budget and its backoff timer.
 *  - a 401 means "not signed in", not "broken": the row stays pending (so the next sync after
 *    sign-in delivers it) but burns no retry budget, since a backoff cannot restore a session.
 *
 * 408 and 429 are 4xx by number yet self-resolving, so they must land on the transient side.
 *
 * Harness: the REAL offline-storage over the stateful localStorage mock (so parking is asserted on
 * the persisted row, not on a spy), with only `global.fetch` mocked — same shape as
 * sync-manager-reap.test.
 */

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

/** Conflict-check GET always finds nothing; the create POST answers with `status`. */
function postFailsWith(status: number, message = 'nope'): void {
	mockFetch.mockImplementation((_url: string, init?: { method?: string }) => {
		const method = init?.method ?? 'GET';
		if (method === 'GET') return Promise.resolve(apiOk([]));
		return Promise.resolve(apiError(status, message));
	});
}

const ls = (global as unknown as { localStorageMock: { clear: () => void } }).localStorageMock;

/** A COMPLETE row — nothing local can reject it, so only the HTTP status decides its fate. */
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

/** The backoff delays this config produces (retryDelay * 2^n) — never 3000, syncAll's idle reset. */
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

		// Self-resolving by definition, despite being 4xx.
		expect(classifySyncFailure(new ApiError('timeout', 408))).toBe('transient');
		expect(classifySyncFailure(new ApiError('slow down', 429))).toBe('transient');
		expect(classifySyncFailure(new ApiError('boom', 500))).toBe('transient');
		expect(classifySyncFailure(new ApiError('gateway', 502))).toBe('transient');
		// No status at all: fetch rejected, request aborted, or a non-API throw.
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
			expect(result.failed).toBe(0); // not a transient failure — nothing to retry
			expect(result.errors).toContain('amount must be positive');
			// The persisted row is parked, so getPendingExpenses stops offering it to every later run,
			// and it carries the server's own reason — the needs-attention card has to explain it, and
			// the only other explanation on offer is the fuel one, which would be a lie here.
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

			// A second run must not touch it at all: parked rows are out of the pending set.
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
			// Still deliverable after the next sign-in: pending, not parked as broken.
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
