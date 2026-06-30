/**
 * #135 — SyncManager.syncAll reaps SYNCED rows from localStorage after a run.
 *
 * The legacy `syncOfflineExpenses` clears synced rows (`clearSyncedExpenses`) once they POST, but the
 * modern `SyncManager.syncAll` previously only marked each row `synced:true` and NEVER cleared them — so
 * successfully-synced rows lingered in localStorage forever (unbounded growth; `getPendingExpenses`
 * filters `!synced` so there was no correctness bug, just a leak). The fix reaps after the run.
 *
 * These pin the reap contract: a fully-synced run empties the queue, and a PARTIAL run reaps ONLY the
 * synced rows while leaving the still-pending one for the next attempt (the data-safety invariant — a
 * row that did not sync must survive to retry). Real offline-storage over the stateful localStorage mock;
 * only `global.fetch` is mocked, the same harness as sync-offline-expenses.test.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { onlineStatus, syncState } from '../../../stores/offline.svelte';
import {
	loadOfflineExpenses,
	type OfflineExpense,
	saveOfflineExpenses
} from '../../offline-storage';
import { syncManager } from '../sync-manager';

const mockFetch = vi.fn();
global.fetch = mockFetch;

function apiOk(data: unknown = { id: 'server-1' }): Response {
	return new Response(JSON.stringify({ success: true, data }), {
		status: 200,
		headers: { 'content-type': 'application/json' }
	});
}

// The setup's localStorage mock is stateful; reset it between tests.
const ls = (global as unknown as { localStorageMock: { clear: () => void } }).localStorageMock;

function pending(id: string, over: Partial<OfflineExpense> = {}): OfflineExpense {
	return {
		id,
		clientId: `cid-${id}`,
		vehicleId: 'v1',
		tags: [],
		category: 'misc',
		amount: 10,
		date: '2024-06-01',
		timestamp: Date.now(),
		synced: false,
		version: '3.0',
		...over
	};
}

describe('SyncManager.syncAll — reaps synced rows (#135)', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		ls.clear();
		syncState.current = 'idle';
		onlineStatus.current = true; // syncAll throws if offline
	});

	it('a fully-synced run empties the offline queue (no lingering synced rows)', async () => {
		saveOfflineExpenses([pending('a'), pending('b')]);
		// Each expense: a GET existing-check (→ [] = none) then a POST (→ ok). Fresh Response per call
		// (a Response body is a single-use stream).
		mockFetch.mockImplementation((_url: string, init?: { method?: string }) => {
			const method = init?.method ?? 'GET';
			if (method === 'GET') return Promise.resolve(apiOk([])); // no existing match
			return Promise.resolve(apiOk());
		});

		const result = await syncManager.syncAll();

		expect(result.synced).toBe(2);
		expect(result.failed).toBe(0);
		// THE #135 ASSERTION: both synced rows were reaped — localStorage is empty, not retaining synced rows.
		expect(loadOfflineExpenses()).toHaveLength(0);
	});

	it('a PARTIAL run reaps only the synced row and keeps the still-pending one for retry', async () => {
		saveOfflineExpenses([pending('ok'), pending('bad')]);
		// 'ok' GET→[]/POST→200; 'bad' GET→[] then POST rejects (transient) → stays pending (not synced).
		mockFetch.mockImplementation((_url: string, init?: { method?: string }) => {
			const method = init?.method ?? 'GET';
			if (method === 'GET') return Promise.resolve(apiOk([]));
			const body = JSON.parse((init as { body?: string }).body ?? '{}');
			if (body.clientId === 'cid-bad') return Promise.reject(new Error('network blip'));
			return Promise.resolve(apiOk());
		});

		const result = await syncManager.syncAll();

		expect(result.synced).toBe(1);
		expect(result.failed).toBe(1);
		// The synced 'ok' row is reaped; the failed 'bad' row SURVIVES to retry (data-safety: no lost write).
		const remaining = loadOfflineExpenses();
		expect(remaining).toHaveLength(1);
		expect(remaining[0]?.id).toBe('bad');
		expect(remaining[0]?.synced).toBe(false);
	});
});
