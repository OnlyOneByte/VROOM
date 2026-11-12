import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OfflineExpense } from '../../offline-storage';

const mockFetch = vi.fn();
global.fetch = mockFetch;

const ls = (global as unknown as { localStorageMock: { clear: () => void } }).localStorageMock;

function apiOk(data: unknown): Response {
	return new Response(JSON.stringify({ success: true, data }), {
		status: 200,
		headers: { 'content-type': 'application/json' }
	});
}

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

function deliveries(): number {
	return mockFetch.mock.calls.filter(([url, init]) => {
		const method = (init as { method?: string } | undefined)?.method ?? 'GET';
		return method === 'POST' && String(url).includes('/api/v1/expenses');
	}).length;
}

async function freshGraph() {
	vi.resetModules();
	const storage = await import('../../offline-storage');
	const { onlineStatus, syncState } = await import('../../../stores/offline.svelte');
	const { syncConfig, syncManager } = await import('../sync-manager');
	syncState.current = 'idle';
	syncConfig.current = {
		maxRetries: 3,
		retryDelay: 100,
		batchSize: 10,
		conflictResolution: 'ask_user'
	};
	return { storage, onlineStatus, syncManager };
}

describe('setupAutoSync — delivery at app open', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		ls.clear();
		mockFetch.mockImplementation((_url: string, init?: { method?: string }) =>
			Promise.resolve(apiOk((init?.method ?? 'GET') === 'GET' ? [] : { id: 'server-1' }))
		);
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('delivers a queued expense on mount, with no online transition', async () => {
		const { storage, onlineStatus, syncManager } = await freshGraph();
		onlineStatus.current = true;
		expect(storage.saveOfflineExpenses([pending('queued')])).toBe(true);

		syncManager.setupAutoSync();
		await vi.advanceTimersByTimeAsync(2500);

		expect(deliveries()).toBe(1);
		expect(storage.getPendingExpenses()).toHaveLength(0);
	});

	it('stays quiet on mount when the outbox is empty', async () => {
		const { onlineStatus, syncManager } = await freshGraph();
		onlineStatus.current = true;

		syncManager.setupAutoSync();
		await vi.advanceTimersByTimeAsync(2500);

		expect(deliveries()).toBe(0);
	});

	it('stays quiet on mount while offline — the transition listener owns that case', async () => {
		const { storage, onlineStatus, syncManager } = await freshGraph();
		onlineStatus.current = false;
		storage.saveOfflineExpenses([pending('queued')]);

		syncManager.setupAutoSync();
		await vi.advanceTimersByTimeAsync(2500);

		expect(deliveries()).toBe(0);
		expect(storage.getPendingExpenses()).toHaveLength(1);
	});
});
