import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OfflineExpense } from '../../offline-storage';
import type { SyncConflict } from '../sync-state.svelte';

const { uploadPhoto } = vi.hoisted(() => ({ uploadPhoto: vi.fn() }));
vi.mock('#lib/services/expense-api.ts', () => ({ expenseApi: { uploadPhoto } }));

const mockFetch = vi.fn();
global.fetch = mockFetch;

const ls = (global as unknown as { localStorageMock: { clear: () => void } }).localStorageMock;

type FakeRequest = {
	result?: unknown;
	error?: unknown;
	onsuccess?: () => void;
	onerror?: () => void;
	onupgradeneeded?: () => void;
};

function inMemoryIndexedDB() {
	const stores = new Map<string, Map<unknown, unknown>>();
	const database = {
		createObjectStore(name: string) {
			stores.set(name, new Map());
		},
		transaction(name: string) {
			const store = stores.get(name)!;
			const transaction: { oncomplete?: () => void; objectStore: () => unknown } = {
				objectStore: () => ({
					put: (value: unknown, key: unknown) => (store.set(key, value), { result: key }),
					get: (key: unknown) => ({ result: store.get(key) }),
					delete: (key: unknown) => (store.delete(key), { result: undefined })
				})
			};
			queueMicrotask(() => transaction.oncomplete?.());
			return transaction;
		},
		close() {}
	};
	return {
		stores,
		open() {
			const request: FakeRequest = {};
			queueMicrotask(() => {
				request.result = database;
				if (!stores.has('photos')) request.onupgradeneeded?.();
				request.onsuccess?.();
			});
			return request;
		}
	};
}

function respond(status: number, data: unknown): Response {
	return new Response(
		JSON.stringify(status < 400 ? { success: true, data } : { error: { message: String(data) } }),
		{ status, headers: { 'content-type': 'application/json' } }
	);
}

function queued(overrides: Partial<OfflineExpense> = {}): OfflineExpense {
	return {
		id: 'e1',
		clientId: 'cid-1',
		vehicleId: 'v1',
		tags: [],
		category: 'misc',
		amount: 12.5,
		date: '2024-06-01T12:00:00.000Z',
		timestamp: 0,
		synced: false,
		version: '3.0',
		...overrides
	};
}

function serverRow(overrides: Record<string, unknown> = {}) {
	return {
		id: 'server-1',
		clientId: 'cid-1',
		vehicleId: 'v1',
		userId: 'u1',
		tags: [],
		category: 'misc',
		expenseAmount: 12.5,
		date: '2024-06-01T12:00:00.000Z',
		createdAt: '2024-06-01T12:00:05.000Z',
		updatedAt: '2024-06-01T12:00:05.000Z',
		...overrides
	};
}

function photo(name: string): File {
	return new File([name], name, { type: 'image/jpeg' });
}

function overwrites(): Array<Record<string, unknown>> {
	return mockFetch.mock.calls
		.filter(
			([url, init]) =>
				(init as { method?: string } | undefined)?.method === 'PUT' &&
				String(url).endsWith('/api/v1/expenses/server-1')
		)
		.map(([, init]) => JSON.parse((init as { body: string }).body));
}

function posts(): Array<Record<string, unknown>> {
	return mockFetch.mock.calls
		.filter(([, init]) => (init as { method?: string } | undefined)?.method === 'POST')
		.map(([, init]) => JSON.parse((init as { body: string }).body));
}

const MODULE_LOAD_TIMEOUT_MS = 60_000;

let storage: typeof import('../../offline-storage');
let syncManager: (typeof import('../sync-manager'))['syncManager'];

describe('offline photo delivery', () => {
	beforeEach(async () => {
		vi.clearAllMocks();
		ls.clear();
		vi.stubGlobal('indexedDB', inMemoryIndexedDB());
		vi.resetModules();
		storage = await import('../../offline-storage');
		({ syncManager } = await import('../sync-manager'));
		const { onlineStatus, syncState } = await import('../../../stores/offline.svelte');
		const { syncConfig } = await import('../sync-state.svelte');
		onlineStatus.current = true;
		syncState.current = 'idle';
		syncConfig.current = {
			maxRetries: 0,
			retryDelay: 100,
			conflictResolution: 'ask_user'
		};
		uploadPhoto.mockResolvedValue({ id: 'photo' });
	}, MODULE_LOAD_TIMEOUT_MS);

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('stores, reads back and clears queued photos in IndexedDB', async () => {
		const first = photo('a.jpg');

		expect(await storage.savePendingPhotos('cid-1', [first])).toBe(true);
		expect(await storage.loadPendingPhotos('cid-1')).toEqual([first]);

		expect(await storage.savePendingPhotos('cid-1', [])).toBe(true);
		expect(await storage.loadPendingPhotos('cid-1')).toEqual([]);

		await storage.savePendingPhotos('cid-2', [first]);
		await storage.deletePendingPhotos('cid-2');
		expect(await storage.loadPendingPhotos('cid-2')).toEqual([]);
	});

	it('queues an expense with its photos under the same clientId', async () => {
		const first = photo('a.jpg');

		expect(
			await storage.addOfflineExpense(
				{ vehicleId: 'v1', tags: [], category: 'misc', amount: 1, date: '2024-06-01' },
				[first],
				'cid-9'
			)
		).toBe(true);

		expect(storage.loadOfflineExpenses()[0]?.clientId).toBe('cid-9');
		expect(await storage.loadPendingPhotos('cid-9')).toEqual([first]);
	});

	it('keeps only the photo that failed, and sends just that one on the next sync', async () => {
		const [first, second] = [photo('a.jpg'), photo('b.jpg')];
		storage.saveOfflineExpenses([queued()]);
		await storage.savePendingPhotos('cid-1', [first, second]);
		mockFetch.mockImplementation((_url: string, init?: { method?: string }) =>
			Promise.resolve(
				(init?.method ?? 'GET') === 'GET' ? respond(200, []) : respond(201, serverRow())
			)
		);
		uploadPhoto
			.mockResolvedValueOnce({ id: 'p1' })
			.mockRejectedValueOnce(new TypeError('Failed to fetch'));

		const firstRun = await syncManager.syncAll();

		expect(firstRun.failed).toBe(1);
		expect(await storage.loadPendingPhotos('cid-1')).toEqual([second]);

		mockFetch.mockImplementation(() => Promise.resolve(respond(200, serverRow())));
		const secondRun = await syncManager.syncAll();

		expect(secondRun.synced).toBe(1);
		expect(posts()).toHaveLength(2);
		expect(mockFetch.mock.calls.filter(([, init]) => (init?.method ?? 'GET') === 'GET')).toEqual(
			[]
		);
		expect(uploadPhoto.mock.calls.map(call => (call[2] as File).name)).toEqual([
			'a.jpg',
			'b.jpg',
			'b.jpg'
		]);
		expect(await storage.loadPendingPhotos('cid-1')).toEqual([]);
	});

	it('parks a photo the server rejects without treating the saved expense as unsynced', async () => {
		storage.saveOfflineExpenses([queued()]);
		await storage.savePendingPhotos('cid-1', [photo('huge.jpg')]);
		mockFetch.mockImplementation((_url: string, init?: { method?: string }) =>
			Promise.resolve(
				(init?.method ?? 'GET') === 'GET' ? respond(200, []) : respond(201, serverRow())
			)
		);
		const { ApiError } = await import('../../error-handling');
		uploadPhoto.mockRejectedValueOnce(new ApiError('File too large', 413));

		await syncManager.syncAll();
		const [parked] = storage.getNeedsAttentionExpenses();
		expect(parked?.serverId).toBe('server-1');
		expect(parked?.attentionReason).toContain("A photo couldn't be uploaded");

		mockFetch.mockClear();
		uploadPhoto.mockResolvedValueOnce({ id: 'p1' });
		await syncManager.retryParked();

		expect(posts()).toHaveLength(0);
		expect(uploadPhoto).toHaveBeenLastCalledWith('expense', 'server-1', expect.any(File));
		expect(storage.loadOfflineExpenses()).toHaveLength(0);
	});

	it('uploads each photo once when two resolutions of the same entry run at the same time', async () => {
		storage.saveOfflineExpenses([queued()]);
		await storage.savePendingPhotos('cid-1', [photo('a.jpg')]);
		let release!: () => void;
		const gate = new Promise<void>(resolve => {
			release = resolve;
		});
		uploadPhoto.mockImplementationOnce(() => gate.then(() => ({ id: 'p1' })));
		const conflict: SyncConflict = {
			id: 'e1',
			localExpense: queued(),
			serverExpense: { id: 'server-1', amount: 20, date: '2024-06-01', tags: [] }
		};

		const both = Promise.all([
			syncManager.resolveConflict(conflict, 'keep_server'),
			syncManager.resolveConflict(conflict, 'keep_server')
		]);
		await vi.waitFor(() => expect(uploadPhoto).toHaveBeenCalled());
		release();

		expect(await both).toEqual([true, true]);
		expect(uploadPhoto).toHaveBeenCalledTimes(1);
	});
});

describe('conflicts the day-window lookup cannot see', () => {
	beforeEach(async () => {
		vi.clearAllMocks();
		ls.clear();
		vi.resetModules();
		storage = await import('../../offline-storage');
		({ syncManager } = await import('../sync-manager'));
		const { onlineStatus, syncState } = await import('../../../stores/offline.svelte');
		onlineStatus.current = true;
		syncState.current = 'idle';
	}, MODULE_LOAD_TIMEOUT_MS);

	function serveLookupThenCreate(created: ReturnType<typeof serverRow>): void {
		mockFetch.mockImplementation((_url: string, init?: { method?: string }) =>
			Promise.resolve((init?.method ?? 'GET') === 'GET' ? respond(200, []) : respond(201, created))
		);
	}

	it('flags a server copy that was moved to another date and edited', async () => {
		storage.saveOfflineExpenses([queued()]);
		serveLookupThenCreate(
			serverRow({ date: '2024-07-15T12:00:00.000Z', updatedAt: '2024-07-15T09:00:00.000Z' })
		);

		const result = await syncManager.syncAll();

		expect(result.conflicts).toHaveLength(1);
		expect(result.conflicts[0]?.serverExpense.id).toBe('server-1');
	});

	it('flags a server copy that was moved to another vehicle', async () => {
		storage.saveOfflineExpenses([queued()]);
		serveLookupThenCreate(serverRow({ vehicleId: 'v2', updatedAt: '2024-07-15T09:00:00.000Z' }));

		const result = await syncManager.syncAll();

		expect(result.conflicts).toHaveLength(1);
	});

	it('does not flag a row the server normalised on create, as long as nobody edited it', async () => {
		storage.saveOfflineExpenses([queued()]);
		serveLookupThenCreate(serverRow({ description: 'trimmed by the server' }));

		const result = await syncManager.syncAll();

		expect(result.conflicts).toHaveLength(0);
		expect(result.synced).toBe(1);
	});

	it('does not flag the row the create just made', async () => {
		storage.saveOfflineExpenses([queued()]);
		serveLookupThenCreate(serverRow());

		const result = await syncManager.syncAll();

		expect(result.conflicts).toHaveLength(0);
		expect(result.synced).toBe(1);
	});

	it('parks a photo the server rejects while a conflict is resolved, and still resolves it', async () => {
		storage.saveOfflineExpenses([queued()]);
		vi.stubGlobal('indexedDB', inMemoryIndexedDB());
		await storage.savePendingPhotos('cid-1', [photo('huge.jpg')]);
		const { ApiError } = await import('../../error-handling');
		uploadPhoto.mockRejectedValueOnce(new ApiError('File too large', 413));
		const conflict: SyncConflict = {
			id: 'e1',
			localExpense: queued(),
			serverExpense: { id: 'server-1', amount: 20, date: '2024-06-01', tags: [] }
		};

		expect(await syncManager.resolveConflict(conflict, 'keep_server')).toBe(true);

		const [parked] = storage.getNeedsAttentionExpenses();
		expect(parked?.serverId).toBe('server-1');
		expect(parked?.attentionReason).toContain("A photo couldn't be uploaded");
		vi.unstubAllGlobals();
	});

	it('Keep My Version clears the fields the server copy gained', async () => {
		mockFetch.mockResolvedValue(respond(201, serverRow()));
		const conflict: SyncConflict = {
			id: 'e1',
			localExpense: queued(),
			serverExpense: {
				id: 'server-1',
				amount: 20,
				date: '2024-06-01',
				tags: [],
				description: 'added later'
			}
		};

		await syncManager.resolveConflict(conflict, 'keep_local');

		expect(overwrites()[0]).toMatchObject({
			vehicleId: 'v1',
			tags: [],
			description: null,
			location: null,
			missedFillup: false,
			sourceType: null,
			sourceId: null
		});
	});

	it('Keep My Version recreates the expense when the server copy was deleted meanwhile', async () => {
		storage.saveOfflineExpenses([queued()]);
		mockFetch.mockImplementation((_url: string, init?: { method?: string }) =>
			Promise.resolve(
				init?.method === 'PUT'
					? respond(404, 'Expense not found')
					: respond(201, serverRow({ id: 'server-2' }))
			)
		);
		const conflict: SyncConflict = {
			id: 'e1',
			localExpense: queued(),
			serverExpense: { id: 'server-1', amount: 20, date: '2024-06-01', tags: [] }
		};

		expect(await syncManager.resolveConflict(conflict, 'keep_local')).toBe(true);

		expect(posts()).toEqual([expect.objectContaining({ clientId: 'cid-1', expenseAmount: 12.5 })]);
		expect(storage.loadOfflineExpenses()[0]?.synced).toBe(true);
	});

	it('Keep My Version keeps the conflict when the 404 hides a record that still exists', async () => {
		storage.saveOfflineExpenses([queued()]);
		mockFetch.mockImplementation((_url: string, init?: { method?: string }) =>
			Promise.resolve(
				init?.method === 'PUT' ? respond(404, 'Vehicle not found') : respond(201, serverRow())
			)
		);
		const conflict: SyncConflict = {
			id: 'e1',
			localExpense: queued(),
			serverExpense: { id: 'server-1', amount: 20, date: '2024-06-01', tags: [] }
		};

		expect(await syncManager.resolveConflict(conflict, 'keep_local')).toBe(false);
		expect(storage.loadOfflineExpenses()[0]?.synced).toBe(false);
	});

	it('Keep My Version still fails, and keeps the conflict, when the overwrite is refused', async () => {
		mockFetch.mockResolvedValue(respond(403, 'Forbidden'));
		const conflict: SyncConflict = {
			id: 'e1',
			localExpense: queued(),
			serverExpense: { id: 'server-1', amount: 20, date: '2024-06-01', tags: [] }
		};

		expect(await syncManager.resolveConflict(conflict, 'keep_local')).toBe(false);
		expect(posts()).toHaveLength(0);
	});

	it('Keep My Version keeps a financing link the local copy has', async () => {
		mockFetch.mockResolvedValue(respond(200, serverRow()));
		const conflict: SyncConflict = {
			id: 'e1',
			localExpense: queued({ sourceType: 'financing', sourceId: 'loan-1' }),
			serverExpense: { id: 'server-1', amount: 20, date: '2024-06-01', tags: [] }
		};

		await syncManager.resolveConflict(conflict, 'keep_local');

		expect(overwrites()[0]).toMatchObject({ sourceType: 'financing', sourceId: 'loan-1' });
	});
});
