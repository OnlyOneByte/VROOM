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

describe('SyncManager.syncAll — reaps synced rows', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		ls.clear();
		syncState.current = 'idle';
		onlineStatus.current = true;
	});

	it('a fully-synced run empties the offline queue (no lingering synced rows)', async () => {
		saveOfflineExpenses([pending('a'), pending('b')]);
		mockFetch.mockImplementation((_url: string, init?: { method?: string }) => {
			const method = init?.method ?? 'GET';
			if (method === 'GET') return Promise.resolve(apiOk([]));
			return Promise.resolve(apiOk());
		});

		const result = await syncManager.syncAll();

		expect(result.synced).toBe(2);
		expect(result.failed).toBe(0);
		expect(loadOfflineExpenses()).toHaveLength(0);
	});

	it('a PARTIAL run reaps only the synced row and keeps the still-pending one for retry', async () => {
		saveOfflineExpenses([pending('ok'), pending('bad')]);
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
		const remaining = loadOfflineExpenses();
		expect(remaining).toHaveLength(1);
		expect(remaining[0]?.id).toBe('bad');
		expect(remaining[0]?.synced).toBe(false);
	});
});
