import { describe, it, expect, beforeEach, vi } from 'vitest';
import { syncManager, syncConfig, type SyncConflict } from '../sync/sync-manager';
import { onlineStatus, syncState } from '../../stores/offline.svelte';
import type { OfflineExpense } from '../offline-storage';

// Mock fetch (apiClient uses fetch internally)
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock the localStorage-touching offline-storage functions, but keep the REAL
// offlineExpenseToBackend (C205): it's a pure mapper with no side-effects, and stubbing it
// would (a) make these tests assert against a fake transform and (b) break the sync paths that
// now route through it (they'd call `undefined`). importActual pulls in the genuine mapper.
vi.mock('../offline-storage', async () => {
	const actual = await vi.importActual<typeof import('../offline-storage')>('../offline-storage');
	return {
		offlineExpenseToBackend: actual.offlineExpenseToBackend,
		loadOfflineExpenses: vi.fn(),
		saveOfflineExpenses: vi.fn(),
		markExpenseAsSynced: vi.fn(),
		clearSyncedExpenses: vi.fn()
	};
});

import { loadOfflineExpenses } from '../offline-storage';

/** Helper: create a mock Response that apiClient can process */
function apiOk(data: unknown) {
	return new Response(JSON.stringify({ success: true, data }), {
		status: 200,
		headers: { 'content-type': 'application/json' }
	});
}

function apiError(status: number, message = 'Error') {
	return new Response(JSON.stringify({ error: { message } }), {
		status,
		headers: { 'content-type': 'application/json' }
	});
}

describe('Sync Manager', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		onlineStatus.current = true;
		syncState.current = 'idle';

		syncConfig.current = {
			maxRetries: 3,
			retryDelay: 100,
			batchSize: 10,
			conflictResolution: 'ask_user'
		};
	});

	describe('syncAll', () => {
		it('should throw error when offline', async () => {
			onlineStatus.current = false;
			await expect(syncManager.syncAll()).rejects.toThrow('Cannot sync while offline');
		});

		it('should throw error when sync already in progress', async () => {
			const mockExpenses: OfflineExpense[] = [
				{
					id: 'test-1',
					vehicleId: 'vehicle-1',
					tags: ['fuel'],
					category: 'fuel',
					amount: 50.0,
					date: '2024-01-01',
					mileage: 50000,
					volume: 10.5,
					timestamp: Date.now(),
					synced: false
				}
			];

			vi.mocked(loadOfflineExpenses).mockReturnValue(mockExpenses);
			mockFetch.mockResolvedValue(apiOk([]));

			const firstSync = syncManager.syncAll();
			await expect(syncManager.syncAll()).rejects.toThrow('Sync already in progress');
			await firstSync;
		});

		it('should successfully sync pending expenses', async () => {
			const mockExpenses: OfflineExpense[] = [
				{
					id: 'test-1',
					vehicleId: 'vehicle-1',
					tags: ['fuel'],
					category: 'fuel',
					amount: 50.0,
					date: '2024-01-01',
					mileage: 50000,
					volume: 10.5,
					timestamp: Date.now(),
					synced: false
				}
			];

			vi.mocked(loadOfflineExpenses).mockReturnValue(mockExpenses);

			// First call: conflict check (no existing expenses)
			// Second call: create expense
			mockFetch.mockResolvedValueOnce(apiOk([])).mockResolvedValueOnce(apiOk({ id: 'server-1' }));

			const result = await syncManager.syncAll();

			expect(result.success).toBe(true);
			expect(result.synced).toBe(1);
			expect(result.failed).toBe(0);
			expect(result.conflicts).toHaveLength(0);
		});

		it('should handle API errors gracefully', async () => {
			const mockExpenses: OfflineExpense[] = [
				{
					id: 'test-1',
					vehicleId: 'vehicle-1',
					tags: ['fuel'],
					category: 'fuel',
					amount: 50.0,
					date: '2024-01-01',
					mileage: 50000,
					volume: 10.5,
					timestamp: Date.now(),
					synced: false
				}
			];

			vi.mocked(loadOfflineExpenses).mockReturnValue(mockExpenses);

			// Conflict check succeeds, creation fails
			mockFetch
				.mockResolvedValueOnce(apiOk([]))
				.mockResolvedValueOnce(apiError(500, 'Server Error'));

			const result = await syncManager.syncAll();

			expect(result.success).toBe(false);
			expect(result.synced).toBe(0);
			expect(result.failed).toBe(1);
		});

		it('should detect and report conflicts', async () => {
			const mockExpenses: OfflineExpense[] = [
				{
					id: 'test-1',
					vehicleId: 'vehicle-1',
					tags: ['fuel'],
					category: 'fuel',
					amount: 50.0,
					date: '2024-01-01',
					mileage: 50000,
					volume: 10.5,
					timestamp: Date.now(),
					synced: false
				}
			];

			const existingExpense = {
				id: 'server-1',
				tags: ['fuel'],
				category: 'fuel',
				amount: 50.0,
				date: '2024-01-01'
			};

			vi.mocked(loadOfflineExpenses).mockReturnValue(mockExpenses);

			// Conflict check returns existing expense
			mockFetch.mockResolvedValueOnce(apiOk([existingExpense]));

			const result = await syncManager.syncAll();

			expect(result.success).toBe(false);
			expect(result.synced).toBe(0);
			expect(result.conflicts).toHaveLength(1);
			expect(result.conflicts[0]?.conflictType).toBe('duplicate');
		});
	});

	describe('resolveConflict', () => {
		it('should resolve conflict by keeping local version', async () => {
			const conflict: SyncConflict = {
				id: 'test-1',
				localExpense: {
					id: 'test-1',
					vehicleId: 'vehicle-1',
					tags: ['fuel'],
					category: 'fuel',
					amount: 50.0,
					date: '2024-01-01',
					mileage: 50000,
					volume: 10.5,
					timestamp: Date.now(),
					synced: false
				},
				serverExpense: { tags: ['fuel'], amount: 45.0, date: '2024-01-01' },
				conflictType: 'modified'
			};

			mockFetch.mockResolvedValueOnce(apiOk({ id: 'server-1' }));

			const result = await syncManager.resolveConflict(conflict, 'keep_local');
			expect(result).toBe(true);
		});

		it('should resolve conflict by keeping server version', async () => {
			const conflict: SyncConflict = {
				id: 'test-1',
				localExpense: {
					id: 'test-1',
					vehicleId: 'vehicle-1',
					tags: ['fuel'],
					category: 'fuel',
					amount: 50.0,
					date: '2024-01-01',
					mileage: 50000,
					volume: 10.5,
					timestamp: Date.now(),
					synced: false
				},
				serverExpense: { tags: ['fuel'], amount: 45.0, date: '2024-01-01' },
				conflictType: 'duplicate'
			};

			const result = await syncManager.resolveConflict(conflict, 'keep_server');
			expect(result).toBe(true);
		});

		// C270 deep-review: the existing two tests only assert the boolean — not the load-bearing
		// SIDE EFFECTS of each resolution (the data-safety contract: a user's conflict choice must be
		// honored exactly). These pin the three uncovered outcomes.
		function modifiedConflict(): SyncConflict {
			return {
				id: 'c-1',
				localExpense: {
					id: 'c-1',
					clientId: 'cid-c-1',
					vehicleId: 'vehicle-1',
					tags: ['fuel'],
					category: 'fuel',
					amount: 50.0,
					date: '2024-01-01',
					mileage: 50000,
					volume: 10.5,
					timestamp: Date.now(),
					synced: false
				},
				serverExpense: { tags: ['fuel'], amount: 45.0, date: '2024-01-01' },
				conflictType: 'modified'
			};
		}

		it('keep_local: POSTs forceOverwrite + the idempotency clientId, returns true', async () => {
			mockFetch.mockResolvedValueOnce(apiOk({ id: 'server-1' }));

			const result = await syncManager.resolveConflict(modifiedConflict(), 'keep_local');

			expect(result).toBe(true);
			// The overwrite carries forceOverwrite (server row replaced) + the idempotency clientId.
			const body = JSON.parse((mockFetch.mock.calls[0]![1] as { body: string }).body);
			expect(body.forceOverwrite).toBe(true);
			expect(body.clientId).toBe('cid-c-1');
		});

		it('keep_local: a FAILED overwrite returns false (the edit survives to retry, not silently lost)', async () => {
			// The POST rejects — resolveConflict must report failure (the catch→break→return false path)
			// so the user's local edit stays unresolved rather than being dropped (NORTH_STAR #1).
			mockFetch.mockRejectedValueOnce(new Error('network down'));

			const result = await syncManager.resolveConflict(modifiedConflict(), 'keep_local');

			expect(result).toBe(false);
		});

		it('keep_server: returns true WITHOUT any POST (server version wins, no overwrite sent)', async () => {
			const result = await syncManager.resolveConflict(modifiedConflict(), 'keep_server');

			expect(result).toBe(true);
			// No network call — choosing the server version just retires the local entry locally.
			expect(mockFetch).not.toHaveBeenCalled();
		});

		it('merge: delegates to keep_local (documented behavior — local wins via a forceOverwrite POST)', async () => {
			mockFetch.mockResolvedValueOnce(apiOk({ id: 'server-1' }));

			const result = await syncManager.resolveConflict(modifiedConflict(), 'merge');

			expect(result).toBe(true);
			// Same forceOverwrite path as keep_local — proves merge isn't a silent no-op.
			const body = JSON.parse((mockFetch.mock.calls[0]![1] as { body: string }).body);
			expect(body.forceOverwrite).toBe(true);
		});
	});

	describe('retry mechanism', () => {
		it('should track retry count for failed syncs', async () => {
			const mockExpenses: OfflineExpense[] = [
				{
					id: 'test-1',
					vehicleId: 'vehicle-1',
					tags: ['fuel'],
					category: 'fuel',
					amount: 50.0,
					date: '2024-01-01',
					mileage: 50000,
					volume: 10.5,
					timestamp: Date.now(),
					synced: false
				}
			];

			vi.mocked(loadOfflineExpenses).mockReturnValue(mockExpenses);

			// Conflict check ok, creation fails
			mockFetch
				.mockResolvedValueOnce(apiOk([]))
				.mockResolvedValueOnce(apiError(500, 'Server Error'));

			const result = await syncManager.syncAll();

			expect(result.failed).toBe(1);
			expect(syncManager.getRetryCount('test-1')).toBeGreaterThanOrEqual(1);
		});

		it('should respect max retries setting', async () => {
			syncConfig.update(config => ({ ...config, maxRetries: 1 }));

			const mockExpenses: OfflineExpense[] = [
				{
					id: 'test-1',
					vehicleId: 'vehicle-1',
					tags: ['fuel'],
					category: 'fuel',
					amount: 50.0,
					date: '2024-01-01',
					mileage: 50000,
					volume: 10.5,
					timestamp: Date.now(),
					synced: false
				}
			];

			vi.mocked(loadOfflineExpenses).mockReturnValue(mockExpenses);
			mockFetch.mockResolvedValue(apiError(500, 'Server Error'));

			await syncManager.syncAll();
			const firstCount = syncManager.getRetryCount('test-1');

			// Second attempt should not increment beyond max
			mockFetch.mockResolvedValue(apiError(500, 'Server Error'));
			await syncManager.syncAll();
			const secondCount = syncManager.getRetryCount('test-1');

			expect(secondCount).toBeLessThanOrEqual(firstCount + 1);
		});
	});
});

// determineConflictType (C223 guard) — when an offline expense collides with a server row that
// shares a tag (so checkForExistingExpense FINDS it), the conflict is classified 'duplicate' ONLY
// when amount + tags + date ALL match; ANY difference → 'modified'. This is the load-bearing
// data-safety distinction: a 'duplicate' is silently dropped, while 'modified' surfaces the
// collision to the user. Mislabeling a real edit as 'duplicate' would discard the user's offline
// change. Driven through the public syncAll conflict path (the existing-test convention), not via
// private access.
describe('Sync Manager — conflict classification (determineConflictType)', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		onlineStatus.current = true;
		syncState.current = 'idle';
		syncConfig.current = {
			maxRetries: 3,
			retryDelay: 100,
			batchSize: 10,
			conflictResolution: 'ask_user'
		};
	});

	/** Seed one local offline expense + the server row the conflict-check GET returns; run syncAll. */
	async function classifyAgainst(
		local: Partial<OfflineExpense>,
		server: { amount: number; tags: string[]; date: string }
	): Promise<SyncConflict | undefined> {
		const localExpense: OfflineExpense = {
			id: 'local-1',
			vehicleId: 'vehicle-1',
			tags: ['fuel'],
			category: 'fuel',
			amount: 50.0,
			date: '2024-01-01',
			timestamp: Date.now(),
			synced: false,
			...local
		};
		vi.mocked(loadOfflineExpenses).mockReturnValue([localExpense]);
		mockFetch.mockResolvedValueOnce(apiOk([server])); // checkForExistingExpense GET
		const result = await syncManager.syncAll();
		return result.conflicts[0];
	}

	it("amount+tags+date all match → 'duplicate'", async () => {
		const c = await classifyAgainst(
			{ amount: 50, date: '2024-01-01', tags: ['fuel'] },
			{ amount: 50, date: '2024-01-01', tags: ['fuel'] }
		);
		expect(c?.conflictType).toBe('duplicate');
	});

	it("a DIFFERENT amount (tag still matches so it's found) → 'modified', not a silent duplicate", async () => {
		const c = await classifyAgainst(
			{ amount: 50, date: '2024-01-01', tags: ['fuel'] },
			{ amount: 75, date: '2024-01-01', tags: ['fuel'] } // amount differs
		);
		expect(c?.conflictType).toBe('modified');
	});

	it("a DIFFERENT date → 'modified'", async () => {
		const c = await classifyAgainst(
			{ amount: 50, date: '2024-01-01', tags: ['fuel'] },
			{ amount: 50, date: '2024-02-01', tags: ['fuel'] } // date differs
		);
		expect(c?.conflictType).toBe('modified');
	});

	it("an amount within the <0.01 epsilon still counts as matching → 'duplicate'", async () => {
		// 50.00 vs 50.009 → |Δ| < 0.01 → amountMatch true (float-drift tolerance).
		const c = await classifyAgainst(
			{ amount: 50.0, date: '2024-01-01', tags: ['fuel'] },
			{ amount: 50.009, date: '2024-01-01', tags: ['fuel'] }
		);
		expect(c?.conflictType).toBe('duplicate');
	});
});
