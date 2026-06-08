/**
 * Tests for syncOfflineExpenses — the offline-queue → server orchestration that
 * the offline-storage CRUD tests don't touch. This is the branch's namesake and
 * the highest data-loss-stakes path, so it pins the data-safety contract:
 *   - happy path: every pending expense is POSTed (each carrying its idempotency
 *     clientId) and the queue is cleared; syncState ends idle
 *   - PARTIAL failure: when one POST rejects, the already-sent ones are marked
 *     synced (so a retry won't duplicate them), the failed + remaining stay
 *     pending (retried next sync), and syncState goes to 'error' — nothing lost
 *   - a malformed fuel expense (no volume/charge or no mileage) is skipped
 *
 * Uses the REAL offline-storage (round-tripping through the setup's stateful
 * localStorage mock) and mocks only fetch, the way sync-manager.test does.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { syncOfflineExpenses, saveOfflineExpenses, loadOfflineExpenses, type OfflineExpense } from '../offline-storage';
import { syncState } from '../../stores/offline.svelte';

const mockFetch = vi.fn();
global.fetch = mockFetch;

function apiOk(data: unknown = { id: 'server-1' }) {
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

describe('syncOfflineExpenses', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		ls.clear();
		syncState.current = 'idle';
	});

	it('POSTs each pending expense with its clientId, then clears the queue', async () => {
		saveOfflineExpenses([pending('a'), pending('b')]);
		// A fresh Response per call: a Response body is a single-use stream, so a
		// shared mockResolvedValue(...) would make the 2nd apiClient.post throw on
		// an already-consumed body (a test-harness trap, not product behavior).
		mockFetch.mockImplementation(() => Promise.resolve(apiOk()));

		await syncOfflineExpenses();

		expect(mockFetch).toHaveBeenCalledTimes(2);
		// Every POST body carries the idempotency key (so a retry can't duplicate).
		for (const call of mockFetch.mock.calls) {
			const body = JSON.parse((call[1] as { body?: string }).body as string);
			expect(body.clientId).toMatch(/^cid-/);
		}
		// Queue fully drained on success.
		expect(loadOfflineExpenses()).toHaveLength(0);
		expect(syncState.current).toBe('success');
	});

	it('on a mid-batch failure: keeps the failed + remaining pending, no data lost', async () => {
		saveOfflineExpenses([pending('a'), pending('b'), pending('c')]);
		// a succeeds, b fails — c must never be sent this round.
		mockFetch
			.mockResolvedValueOnce(apiOk())
			.mockRejectedValueOnce(new Error('network down'));

		await syncOfflineExpenses();

		// Only a and b were attempted (loop stops at the throw); c untouched.
		expect(mockFetch).toHaveBeenCalledTimes(2);
		expect(syncState.current).toBe('error');

		// 'a' is marked synced (so a retry won't duplicate it); 'b' and 'c' remain
		// pending to retry next sync. Nothing is dropped from the queue.
		const remaining = loadOfflineExpenses();
		const byId = new Map(remaining.map((e) => [e.id, e]));
		expect(byId.get('a')?.synced).toBe(true);
		expect(byId.get('b')?.synced).toBe(false);
		expect(byId.get('c')?.synced).toBe(false);
		// All three still present — the failed batch lost no entries.
		expect(remaining).toHaveLength(3);
	});

	it('skips a malformed fuel expense (missing volume/charge or mileage)', async () => {
		saveOfflineExpenses([
			pending('fuel-bad', { category: 'fuel' }), // no volume/charge, no mileage
			pending('ok')
		]);
		mockFetch.mockImplementation(() => Promise.resolve(apiOk()));

		await syncOfflineExpenses();

		// Only the valid one is POSTed; the malformed fuel entry is skipped.
		expect(mockFetch).toHaveBeenCalledTimes(1);
		const call = mockFetch.mock.calls[0];
		expect(call).toBeDefined();
		const body = JSON.parse((call![1] as { body?: string }).body as string);
		expect(body.clientId).toBe('cid-ok');
	});
});
