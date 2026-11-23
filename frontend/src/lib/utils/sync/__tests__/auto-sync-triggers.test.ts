import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OfflineExpense } from '../../offline-storage';

const mockFetch = vi.fn();
global.fetch = mockFetch;

const ls = (global as unknown as { localStorageMock: { clear: () => void } }).localStorageMock;

function respond(status: number, data: unknown): Response {
	return new Response(
		JSON.stringify(status < 400 ? { success: true, data } : { error: { message: 'Server Error' } }),
		{ status, headers: { 'content-type': 'application/json' } }
	);
}

let serverUp = true;

function deliveries(): number {
	return mockFetch.mock.calls.filter(([url, init]) => {
		const method = (init as { method?: string } | undefined)?.method ?? 'GET';
		return method === 'POST' && String(url).includes('/api/v1/expenses');
	}).length;
}

function postedClientIds(): string[] {
	return mockFetch.mock.calls
		.filter(([, init]) => (init as { method?: string } | undefined)?.method === 'POST')
		.map(([, init]) => JSON.parse((init as { body: string }).body).clientId);
}

function queued(id: string): OfflineExpense {
	return {
		id,
		clientId: `cid-${id}`,
		vehicleId: 'v1',
		tags: [],
		category: 'misc',
		amount: 12.34,
		date: '2024-06-01',
		timestamp: 0,
		synced: false,
		version: '3.0'
	};
}

function setVisibility(state: 'visible' | 'hidden'): void {
	Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
	document.dispatchEvent(new Event('visibilitychange'));
}

const MODULE_LOAD_TIMEOUT_MS = 60_000;

async function freshGraph() {
	vi.resetModules();
	const storage = await import('../../offline-storage');
	const { onlineStatus, syncState } = await import('../../../stores/offline.svelte');
	const { syncConfig, syncManager } = await import('../sync-manager');
	syncState.current = 'idle';
	syncConfig.current = {
		maxRetries: 0,
		retryDelay: 100,
		conflictResolution: 'ask_user'
	};
	return { storage, onlineStatus, syncManager };
}

type Listener = Parameters<typeof document.removeEventListener>;

describe('auto-sync triggers', () => {
	let graph: Awaited<ReturnType<typeof freshGraph>>;
	const documentListeners: Listener[] = [];
	const realAddDocumentListener = document.addEventListener.bind(document);

	function onlineHandler(): () => void {
		const calls = vi.mocked(window.addEventListener).mock.calls;
		const handler = calls.filter(([type]) => type === 'online').at(-1)?.[1];
		return handler as () => void;
	}

	beforeEach(async () => {
		vi.clearAllMocks();
		ls.clear();
		serverUp = true;
		mockFetch.mockImplementation((_url: string, init?: { method?: string }) => {
			if ((init?.method ?? 'GET') === 'GET') return Promise.resolve(respond(200, []));
			return Promise.resolve(serverUp ? respond(201, { id: 'server-1' }) : respond(500, null));
		});
		graph = await freshGraph();
		graph.onlineStatus.current = true;
		vi.spyOn(document, 'addEventListener').mockImplementation((type, listener, options) => {
			documentListeners.push([type, listener]);
			realAddDocumentListener(type, listener, options);
		});
		vi.useFakeTimers();
	}, MODULE_LOAD_TIMEOUT_MS);

	afterEach(() => {
		vi.useRealTimers();
		for (const [type, listener] of documentListeners.splice(0)) {
			document.removeEventListener(type, listener);
		}
		vi.restoreAllMocks();
	});

	it('syncs when the app becomes visible again', async () => {
		const { storage, syncManager } = graph;
		syncManager.setupAutoSync();
		storage.saveOfflineExpenses([queued('a')]);

		setVisibility('hidden');
		await vi.advanceTimersByTimeAsync(2500);
		expect(deliveries()).toBe(0);

		setVisibility('visible');
		await vi.advanceTimersByTimeAsync(2500);
		expect(deliveries()).toBe(1);
		expect(storage.getPendingExpenses()).toHaveLength(0);
	});

	it('keeps retrying a failed queue on a growing interval until it delivers', async () => {
		const { storage, syncManager } = graph;
		serverUp = false;
		storage.saveOfflineExpenses([queued('a')]);
		syncManager.setupAutoSync();

		await vi.advanceTimersByTimeAsync(2500);
		expect(deliveries()).toBe(1);

		await vi.advanceTimersByTimeAsync(30_000);
		expect(deliveries()).toBe(2);

		await vi.advanceTimersByTimeAsync(59_000);
		expect(deliveries()).toBe(2);

		serverUp = true;
		await vi.advanceTimersByTimeAsync(1_000);
		expect(deliveries()).toBe(3);
		expect(storage.getPendingExpenses()).toHaveLength(0);

		await vi.advanceTimersByTimeAsync(15 * 60_000);
		expect(deliveries()).toBe(3);
	});

	it('stops retrying while the device is offline', async () => {
		const { storage, onlineStatus, syncManager } = graph;
		serverUp = false;
		storage.saveOfflineExpenses([queued('a')]);
		syncManager.setupAutoSync();
		await vi.advanceTimersByTimeAsync(2500);
		expect(deliveries()).toBe(1);

		onlineStatus.current = false;
		await vi.advanceTimersByTimeAsync(20 * 60_000);
		expect(deliveries()).toBe(1);
	});

	it('syncs when the device comes back online', async () => {
		const { storage, syncManager } = graph;
		syncManager.setupAutoSync();
		storage.saveOfflineExpenses([queued('a')]);

		onlineHandler()();
		await vi.advanceTimersByTimeAsync(2500);

		expect(deliveries()).toBe(1);
	});

	it('starts retrying an entry queued after setup, once the form asks for it', async () => {
		const { storage, syncManager } = graph;
		syncManager.setupAutoSync();
		serverUp = false;
		storage.saveOfflineExpenses([queued('a')]);

		syncManager.requestAutoSync();
		await vi.advanceTimersByTimeAsync(30_000);
		expect(deliveries()).toBe(1);

		serverUp = true;
		await vi.advanceTimersByTimeAsync(60_000);
		expect(deliveries()).toBe(2);
		expect(storage.getPendingExpenses()).toHaveLength(0);
	});

	it('retries after a failed manual sync', async () => {
		const { storage, syncManager } = graph;
		syncManager.setupAutoSync();
		serverUp = false;
		storage.saveOfflineExpenses([queued('a')]);

		await syncManager.syncAll();
		expect(deliveries()).toBe(1);

		serverUp = true;
		await vi.advanceTimersByTimeAsync(30_000);
		expect(deliveries()).toBe(2);
	});

	it('keeps retrying other entries while a sync conflict waits, and leaves the conflicted one to the dialog', async () => {
		const { storage, syncManager } = graph;
		const { syncConflicts } = await import('../sync-state.svelte');
		syncManager.setupAutoSync();
		serverUp = false;
		storage.saveOfflineExpenses([queued('a'), queued('c')]);
		syncConflicts.current = [
			{
				id: 'c',
				localExpense: queued('c'),
				serverExpense: { id: 's', amount: 1, date: '2024-06-01', tags: [] }
			}
		];

		syncManager.requestAutoSync();
		await vi.advanceTimersByTimeAsync(30_000);
		serverUp = true;
		await vi.advanceTimersByTimeAsync(60_000);

		expect(postedClientIds()).toEqual(['cid-a', 'cid-a']);
		expect(storage.getPendingExpenses().map(e => e.id)).toEqual(['c']);

		await vi.advanceTimersByTimeAsync(20 * 60_000);
		expect(postedClientIds()).toEqual(['cid-a', 'cid-a']);
		syncConflicts.current = [];
	});
});
