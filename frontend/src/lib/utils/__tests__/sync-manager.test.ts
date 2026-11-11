import { describe, it, expect, beforeEach, vi } from 'vitest';
import { syncManager, syncConfig, syncConflicts, type SyncConflict } from '../sync/sync-manager';
import { onlineStatus, syncState } from '../../stores/offline.svelte';
import type { OfflineExpense } from '../offline-storage';

const mockFetch = vi.fn();
global.fetch = mockFetch;

vi.mock('../offline-storage', async () => {
	const actual = await vi.importActual<typeof import('../offline-storage')>('../offline-storage');
	const loadOfflineExpenses = vi.fn();
	return {
		offlineExpenseToBackend: actual.offlineExpenseToBackend,
		isIncompleteFuelExpense: actual.isIncompleteFuelExpense,
		INCOMPLETE_FUEL_REASON: actual.INCOMPLETE_FUEL_REASON,
		loadOfflineExpenses,
		saveOfflineExpenses: vi.fn(),
		markExpenseAsSynced: vi.fn(),
		markExpenseNeedsAttention: vi.fn(),
		clearSyncedExpenses: vi.fn(),
		getPendingExpenses: () =>
			(loadOfflineExpenses() as ReturnType<typeof actual.loadOfflineExpenses>).filter(
				e => !e.synced && !e.needsAttention
			)
	};
});

import { loadOfflineExpenses, markExpenseNeedsAttention } from '../offline-storage';

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
				vehicleId: 'vehicle-1',
				userId: 'user-1',
				tags: ['fuel'],
				category: 'fuel',
				expenseAmount: 50.0,
				volume: 10.5,
				fuelType: '87 (Regular)',
				date: '2024-01-01',
				createdAt: '2024-01-01T00:00:00.000Z',
				updatedAt: '2024-01-01T00:00:00.000Z'
			};

			vi.mocked(loadOfflineExpenses).mockReturnValue(mockExpenses);

			mockFetch.mockResolvedValueOnce(apiOk([existingExpense]));

			const result = await syncManager.syncAll();

			expect(result.success).toBe(false);
			expect(result.synced).toBe(0);
			expect(result.conflicts).toHaveLength(1);
			expect(result.conflicts[0]?.conflictType).toBe('duplicate');
			expect(result.conflicts[0]?.serverExpense?.amount).toBe(50.0);
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
			const body = JSON.parse((mockFetch.mock.calls[0]![1] as { body: string }).body);
			expect(body.forceOverwrite).toBe(true);
			expect(body.clientId).toBe('cid-c-1');
		});

		it('keep_local: a FAILED overwrite returns false (the edit survives to retry, not silently lost)', async () => {
			mockFetch.mockRejectedValueOnce(new Error('network down'));

			const result = await syncManager.resolveConflict(modifiedConflict(), 'keep_local');

			expect(result).toBe(false);
		});

		it('keep_server: returns true WITHOUT any POST (server version wins, no overwrite sent)', async () => {
			const result = await syncManager.resolveConflict(modifiedConflict(), 'keep_server');

			expect(result).toBe(true);
			expect(mockFetch).not.toHaveBeenCalled();
		});

		it('merge: delegates to keep_local (documented behavior — local wins via a forceOverwrite POST)', async () => {
			mockFetch.mockResolvedValueOnce(apiOk({ id: 'server-1' }));

			const result = await syncManager.resolveConflict(modifiedConflict(), 'merge');

			expect(result).toBe(true);
			const body = JSON.parse((mockFetch.mock.calls[0]![1] as { body: string }).body);
			expect(body.forceOverwrite).toBe(true);
		});

		it('keep_local POSTs forceOverwrite and the local clientId to the create route', async () => {
			mockFetch.mockResolvedValueOnce(apiOk({ id: 'server-1' }));

			await syncManager.resolveConflict(modifiedConflict(), 'keep_local');

			const [url, init] = mockFetch.mock.calls[0] as [string, { method: string; body: string }];
			expect(String(url)).toContain('/api/v1/expenses');
			expect(init.method).toBe('POST');
			const body = JSON.parse(init.body);
			expect(body.clientId).toBe('cid-c-1');
			expect(body.forceOverwrite).toBe(true);
		});
	});

	describe('needs-attention parking', () => {
		const malformedFuel: OfflineExpense = {
			id: 'malformed-1',
			clientId: 'cid-malformed-1',
			vehicleId: 'vehicle-1',
			tags: ['fuel'],
			category: 'fuel',
			amount: 50.0,
			date: '2024-01-01',
			timestamp: Date.now(),
			synced: false
		};

		it('parks a malformed fuel row (needsAttention) instead of scheduling a retry', async () => {
			vi.mocked(loadOfflineExpenses).mockReturnValue([malformedFuel]);
			mockFetch.mockResolvedValue(apiOk([]));

			const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
			try {
				const result = await syncManager.syncAll();
				expect(result.needsAttention).toBe(1);
				expect(result.failed).toBe(0);
				expect(vi.mocked(markExpenseNeedsAttention)).toHaveBeenCalledWith(
					'malformed-1',
					expect.stringContaining('volume/charge and mileage')
				);
				expect(syncManager.getRetryCount('malformed-1')).toBe(0);
				const RETRY_DELAYS = new Set([100, 200, 400, 800]);
				const retryScheduled = setTimeoutSpy.mock.calls.some(
					([, delay]) => typeof delay === 'number' && RETRY_DELAYS.has(delay)
				);
				expect(retryScheduled, 'a permanent failure must not schedule a retry').toBe(false);
			} finally {
				setTimeoutSpy.mockRestore();
			}
		});

		it('an already-parked row is NOT re-attempted by a later syncAll (no POST, no re-count)', async () => {
			vi.mocked(loadOfflineExpenses).mockReturnValue([{ ...malformedFuel, needsAttention: true }]);
			mockFetch.mockResolvedValue(apiOk([]));

			const result = await syncManager.syncAll();

			expect(result.synced).toBe(0);
			expect(result.failed).toBe(0);
			expect(result.needsAttention).toBe(0);
			expect(vi.mocked(markExpenseNeedsAttention)).not.toHaveBeenCalled();
			expect(mockFetch).not.toHaveBeenCalled();
			expect(result.success).toBe(true);
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

			mockFetch.mockResolvedValue(apiError(500, 'Server Error'));
			await syncManager.syncAll();
			const secondCount = syncManager.getRetryCount('test-1');

			expect(secondCount).toBeLessThanOrEqual(firstCount + 1);
		});

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
			mockFetch.mockResolvedValueOnce(apiOk([])).mockResolvedValueOnce(apiError(500, 'boom'));

			const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
			try {
				await syncManager.syncAll();
				const scheduled = setTimeoutSpy.mock.calls.find(([, delay]) => delay === 100);
				expect(scheduled, 'first retry scheduled at retryDelay * 2^0 = 100ms').toBeDefined();
			} finally {
				setTimeoutSpy.mockRestore();
			}
		});

		it('does NOT schedule a retry once retries have reached maxRetries (the hard cap)', async () => {
			syncConfig.update(config => ({ ...config, maxRetries: 1, retryDelay: 100 }));
			vi.mocked(loadOfflineExpenses).mockReturnValue([failingExpense('cap-1')]);
			mockFetch.mockResolvedValue(apiError(500, 'boom'));

			vi.useFakeTimers();
			try {
				await syncManager.syncAll();
				expect(syncManager.getRetryCount('cap-1')).toBe(1);

				const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
				await syncManager.syncAll();
				const RETRY_DELAYS = new Set([100, 200, 400, 800]);
				const retryScheduled = setTimeoutSpy.mock.calls.some(
					([, delay]) => typeof delay === 'number' && RETRY_DELAYS.has(delay)
				);
				expect(retryScheduled, 'no retry-backoff timer scheduled past the cap').toBe(false);
				expect(syncManager.getRetryCount('cap-1')).toBe(1);
				setTimeoutSpy.mockRestore();
			} finally {
				vi.useRealTimers();
			}
		});

		it('surfaces a conflict detected during a scheduled retry', async () => {
			syncConfig.update(config => ({ ...config, maxRetries: 3, retryDelay: 100 }));
			vi.mocked(loadOfflineExpenses).mockReturnValue([failingExpense('retry-conf-1')]);
			syncConflicts.current = [];

			vi.useFakeTimers();
			try {
				mockFetch.mockResolvedValueOnce(apiOk([])).mockResolvedValueOnce(apiError(500, 'boom'));
				await syncManager.syncAll();
				expect(syncManager.getRetryCount('retry-conf-1')).toBe(1);
				expect(syncConflicts.current).toHaveLength(0);

				mockFetch.mockResolvedValueOnce(
					apiOk([
						{ id: 'server-x', tags: ['fuel'], category: 'fuel', amount: 50.0, date: '2024-01-01' }
					])
				);
				await vi.advanceTimersByTimeAsync(200);

				expect(syncConflicts.current).toHaveLength(1);
				expect(syncConflicts.current[0]?.localExpense.id).toBe('retry-conf-1');
				expect(syncManager.getRetryCount('retry-conf-1')).toBe(0);
			} finally {
				vi.useRealTimers();
				syncConflicts.current = [];
			}
		});

		it('an orphaned retry does NOT resurrect a conflict already resolved+synced between schedule and fire', async () => {
			syncConfig.update(config => ({ ...config, maxRetries: 3, retryDelay: 100 }));
			const exp = failingExpense('resurrect-1');
			vi.mocked(loadOfflineExpenses).mockReturnValue([exp]);
			syncConflicts.current = [];

			vi.useFakeTimers();
			try {
				mockFetch.mockResolvedValueOnce(apiOk([])).mockResolvedValueOnce(apiError(500, 'boom'));
				await syncManager.syncAll();
				expect(syncManager.getRetryCount('resurrect-1')).toBe(1);

				vi.mocked(loadOfflineExpenses).mockReturnValue([{ ...exp, synced: true }]);
				syncState.current = 'success';

				mockFetch.mockResolvedValueOnce(
					apiOk([
						{
							id: 'server-x',
							tags: ['fuel'],
							category: 'fuel',
							expenseAmount: 50.0,
							date: '2024-01-01'
						}
					])
				);
				await vi.advanceTimersByTimeAsync(200);

				expect(syncConflicts.current).toHaveLength(0);
				expect(syncState.current).not.toBe('error');
			} finally {
				vi.useRealTimers();
				syncConflicts.current = [];
				mockFetch.mockReset();
			}
		});
	});
});

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
		const backendRow = {
			id: 'server-1',
			vehicleId: 'vehicle-1',
			userId: 'user-1',
			tags: server.tags,
			category: 'fuel',
			expenseAmount: server.amount,
			date: server.date,
			createdAt: '2024-01-01T00:00:00.000Z',
			updatedAt: '2024-01-01T00:00:00.000Z'
		};
		mockFetch.mockResolvedValueOnce(apiOk([backendRow]));
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
			{ amount: 75, date: '2024-01-01', tags: ['fuel'] }
		);
		expect(c?.conflictType).toBe('modified');
	});

	it("a DIFFERENT date → 'modified'", async () => {
		const c = await classifyAgainst(
			{ amount: 50, date: '2024-01-01', tags: ['fuel'] },
			{ amount: 50, date: '2024-02-01', tags: ['fuel'] }
		);
		expect(c?.conflictType).toBe('modified');
	});

	it("an amount within the <0.01 epsilon still counts as matching → 'duplicate'", async () => {
		const c = await classifyAgainst(
			{ amount: 50.0, date: '2024-01-01', tags: ['fuel'] },
			{ amount: 50.009, date: '2024-01-01', tags: ['fuel'] }
		);
		expect(c?.conflictType).toBe('duplicate');
	});
});
