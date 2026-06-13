import { describe, it, expect, beforeEach, vi } from 'vitest';
import { syncManager, syncConfig, syncConflicts, type SyncConflict } from '../sync/sync-manager';
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

		// CHARACTERIZATION of #98 (escalated C324): keep_local routes through the CREATE endpoint, whose
		// backend idempotency keys on (userId, clientId). `forceOverwrite` is sent but NOT honored
		// server-side (Zod strips unknown keys) — so this is a plain idempotent CREATE, not a true
		// overwrite. Pin the FE reality: the POST goes to /api/v1/expenses (create) carrying the local
		// row's clientId — NOT a dedicated overwrite/PUT route. When #98 lands (real upsert, or dropping
		// the fuzzy conflict flow), THIS endpoint/shape is what changes, so a regression here is visible.
		it('#98: keep_local POSTs to the CREATE endpoint with the local clientId (idempotency, not a real overwrite)', async () => {
			mockFetch.mockResolvedValueOnce(apiOk({ id: 'server-1' }));

			await syncManager.resolveConflict(modifiedConflict(), 'keep_local');

			const [url, init] = mockFetch.mock.calls[0] as [string, { method: string; body: string }];
			expect(String(url)).toContain('/api/v1/expenses'); // the create route, not an /overwrite or PUT
			expect(init.method).toBe('POST');
			const body = JSON.parse(init.body);
			// The local row's clientId is what governs the outcome (create-idempotency), not forceOverwrite.
			expect(body.clientId).toBe('cid-c-1');
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

		// C325 guard: the EXPONENTIAL BACKOFF + the HARD CAP were both unpinned (the existing tests only
		// check the retryCount counter, never the scheduled delay or that scheduling STOPS at the cap).
		// A regression to a constant/linear delay (retry-storm risk) or an off-by-one cap (retries past
		// maxRetries, or none at all) would pass the counter tests. Spy on setTimeout to pin the actual
		// schedule.
		function failingExpense(id = 'bo-1'): OfflineExpense {
			return {
				id,
				clientId: `cid-${id}`,
				vehicleId: 'vehicle-1',
				tags: ['fuel'],
				category: 'fuel',
				amount: 50.0,
				date: '2024-01-01',
				mileage: 50000,
				volume: 10.5,
				timestamp: Date.now(),
				synced: false
			};
		}

		it('schedules the failed-sync retry with EXPONENTIAL backoff: retryDelay * 2^retries', async () => {
			syncConfig.update(config => ({ ...config, maxRetries: 3, retryDelay: 100 }));
			vi.mocked(loadOfflineExpenses).mockReturnValue([failingExpense()]);
			// conflict-check ok (empty), then the create fails → schedules a retry.
			mockFetch.mockResolvedValueOnce(apiOk([])).mockResolvedValueOnce(apiError(500, 'boom'));

			const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
			try {
				await syncManager.syncAll();
				// FIRST failure → retries was 0 → delay = 100 * 2^0 = 100ms.
				const scheduled = setTimeoutSpy.mock.calls.find(([, delay]) => delay === 100);
				expect(scheduled, 'first retry scheduled at retryDelay * 2^0 = 100ms').toBeDefined();
			} finally {
				setTimeoutSpy.mockRestore();
			}
		});

		it('does NOT schedule a retry once retries have reached maxRetries (the hard cap)', async () => {
			syncConfig.update(config => ({ ...config, maxRetries: 1, retryDelay: 100 }));
			vi.mocked(loadOfflineExpenses).mockReturnValue([failingExpense('cap-1')]);
			mockFetch.mockResolvedValue(apiError(500, 'boom')); // every call fails (conflict-check + create)

			// Fake timers so the FIRST syncAll's scheduled retry can't fire mid-test and pollute the spy
			// (the prior real-timer version flaked on exactly that leakage). We never advance the clock —
			// we only inspect what the SECOND syncAll schedules.
			vi.useFakeTimers();
			try {
				// First syncAll: retries 0 < 1 → schedules one retry, bumps count to 1.
				await syncManager.syncAll();
				expect(syncManager.getRetryCount('cap-1')).toBe(1);

				// Second syncAll: retries 1 is NOT < maxRetries(1) → NO new retry scheduled.
				const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
				await syncManager.syncAll();
				// syncAll ALWAYS schedules a 3000ms idle-reset (sync-manager.ts:116); the RETRY backoff
				// delays are retryDelay * 2^n = 100, 200, 400, … . Assert none of THOSE were scheduled
				// (i.e. ignore the 3000ms idle timer — only the retry-family delays signal a cap breach).
				const RETRY_DELAYS = new Set([100, 200, 400, 800]);
				const retryScheduled = setTimeoutSpy.mock.calls.some(
					([, delay]) => typeof delay === 'number' && RETRY_DELAYS.has(delay)
				);
				expect(retryScheduled, 'no retry-backoff timer scheduled past the cap').toBe(false);
				// And the count never climbs past maxRetries.
				expect(syncManager.getRetryCount('cap-1')).toBe(1);
				setTimeoutSpy.mockRestore();
			} finally {
				vi.useRealTimers();
			}
		});

		// #121 (C424): a conflict detected ON A RETRY must SURFACE (push to syncConflicts.current + clear
		// retryCount), mirroring the main loop. Pre-fix retrySingleExpense acted only on result.success, so
		// a retry-conflict was silently dropped — no resolver dialog, expense stuck pending. Realistic
		// trigger: first POST committed but its response was lost → retry's conflict-check now finds the row.
		it('surfaces a conflict detected during a scheduled RETRY (was silently dropped) — #121', async () => {
			syncConfig.update(config => ({ ...config, maxRetries: 3, retryDelay: 100 }));
			vi.mocked(loadOfflineExpenses).mockReturnValue([failingExpense('retry-conf-1')]);
			syncConflicts.current = [];

			vi.useFakeTimers();
			try {
				// Attempt 1 (main loop): conflict-check ok (empty) → create FAILS (500) → schedules a retry.
				mockFetch.mockResolvedValueOnce(apiOk([])).mockResolvedValueOnce(apiError(500, 'boom'));
				await syncManager.syncAll();
				expect(syncManager.getRetryCount('retry-conf-1')).toBe(1);
				expect(syncConflicts.current).toHaveLength(0); // no conflict yet

				// The RETRY's conflict-check now finds the committed row → a duplicate conflict.
				mockFetch.mockResolvedValueOnce(
					apiOk([{ id: 'server-x', tags: ['fuel'], category: 'fuel', amount: 50.0, date: '2024-01-01' }])
				);
				await vi.advanceTimersByTimeAsync(200); // fire the scheduled retry (100 * 2^0)

				// Pre-fix: still 0 (dropped). Post-fix: the retry-conflict is surfaced + retryCount cleared.
				expect(syncConflicts.current).toHaveLength(1);
				expect(syncConflicts.current[0]?.localExpense.id).toBe('retry-conf-1');
				expect(syncManager.getRetryCount('retry-conf-1')).toBe(0);
			} finally {
				vi.useRealTimers();
				syncConflicts.current = [];
			}
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
