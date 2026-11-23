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
		loadPendingPhotos: vi.fn(async () => []),
		savePendingPhotos: vi.fn(async () => true),
		getPendingExpenses: () =>
			(loadOfflineExpenses() as ReturnType<typeof actual.loadOfflineExpenses>).filter(
				e => !e.synced && !e.needsAttention
			)
	};
});

vi.mock('#lib/services/expense-api.ts', () => ({
	expenseApi: { uploadPhoto: vi.fn(async () => ({ id: 'photo-1' })) }
}));

import {
	loadOfflineExpenses,
	loadPendingPhotos,
	markExpenseAsSynced,
	markExpenseNeedsAttention,
	savePendingPhotos
} from '../offline-storage';
import { expenseApi } from '#lib/services/expense-api.ts';

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

function serverRow(id: string, clientId: string | null) {
	return {
		id,
		clientId,
		vehicleId: 'vehicle-1',
		userId: 'user-1',
		tags: ['fuel'],
		category: 'fuel',
		expenseAmount: 50.0,
		mileage: 50000,
		volume: 10.5,
		fuelType: '87 (Regular)',
		date: '2024-01-01',
		createdAt: '2024-01-01T00:00:00.000Z',
		updatedAt: '2024-01-01T00:00:00.000Z'
	};
}

describe('Sync Manager', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		onlineStatus.current = true;
		syncState.current = 'idle';

		syncConfig.current = {
			maxRetries: 3,
			retryDelay: 100,
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

			mockFetch.mockResolvedValueOnce(apiOk({ id: 'server-1' }));

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

			mockFetch.mockResolvedValueOnce(apiError(500, 'Server Error'));

			const result = await syncManager.syncAll();

			expect(result.success).toBe(false);
			expect(result.synced).toBe(0);
			expect(result.failed).toBe(1);
		});

		it('reports a conflict only when the server copy of the SAME record was changed', async () => {
			const local: OfflineExpense = {
				id: 'test-1',
				clientId: 'cid-test-1',
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
			vi.mocked(loadOfflineExpenses).mockReturnValue([local]);
			mockFetch.mockResolvedValueOnce(
				apiOk({
					...serverRow('server-1', 'cid-test-1'),
					expenseAmount: 45,
					updatedAt: '2024-01-02T00:00:00.000Z'
				})
			);

			const result = await syncManager.syncAll();

			expect(result.success).toBe(false);
			expect(result.synced).toBe(0);
			expect(result.conflicts).toHaveLength(1);
			expect(result.conflicts[0]?.serverExpense.id).toBe('server-1');
			expect(result.conflicts[0]?.serverExpense.amount).toBe(45);
		});

		it('posts a queued expense with its clientId and time zone', async () => {
			vi.mocked(loadOfflineExpenses).mockReturnValue([
				{
					id: 'b',
					clientId: 'cid-b',
					vehicleId: 'vehicle-1',
					tags: ['parking'],
					category: 'misc',
					amount: 25,
					date: '2024-01-01',
					timestamp: Date.now(),
					synced: false
				}
			]);
			mockFetch.mockResolvedValueOnce(apiOk({ id: 'server-b' }));

			const result = await syncManager.syncAll();

			expect(result.conflicts).toHaveLength(0);
			expect(result.synced).toBe(1);
			expect(mockFetch).toHaveBeenCalledTimes(1);
			const post = mockFetch.mock.calls[0] as [string, { method: string; body: string }];
			expect(post[1].method).toBe('POST');
			expect(JSON.parse(post[1].body)).toMatchObject({
				clientId: 'cid-b',
				timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
			});
		});

		it('a replayed entry makes 1 request: the idempotent POST returns the existing row, no conflict', async () => {
			vi.mocked(loadOfflineExpenses).mockReturnValue([
				{
					id: 'test-1',
					clientId: 'cid-test-1',
					vehicleId: 'vehicle-1',
					tags: ['fuel'],
					category: 'fuel',
					amount: 50.0,
					date: '2024-01-01',
					mileage: 50000,
					volume: 10.5,
					fuelType: '87 (Regular)',
					timestamp: Date.now(),
					synced: false
				}
			]);
			mockFetch.mockResolvedValueOnce(apiOk(serverRow('server-1', 'cid-test-1')));

			const result = await syncManager.syncAll();

			expect(result.conflicts).toHaveLength(0);
			expect(result.synced).toBe(1);
			expect(mockFetch).toHaveBeenCalledTimes(1);
			const [url, init] = mockFetch.mock.calls[0] as [string, { method: string }];
			expect(init.method).toBe('POST');
			expect(url).not.toContain('?');
		});

		it('uploads the photos queued with an offline expense once it reaches the server', async () => {
			const photo = new File(['jpeg'], 'receipt.jpg', { type: 'image/jpeg' });
			vi.mocked(loadOfflineExpenses).mockReturnValue([
				{
					id: 'p',
					clientId: 'cid-p',
					vehicleId: 'vehicle-1',
					tags: [],
					category: 'misc',
					amount: 9,
					date: '2024-01-01',
					timestamp: Date.now(),
					synced: false
				}
			]);
			vi.mocked(loadPendingPhotos).mockResolvedValueOnce([photo]);
			mockFetch.mockResolvedValueOnce(apiOk({ id: 'server-p' }));

			const result = await syncManager.syncAll();

			expect(result.synced).toBe(1);
			expect(expenseApi.uploadPhoto).toHaveBeenCalledWith('expense', 'server-p', photo);
			expect(savePendingPhotos).toHaveBeenCalledWith('cid-p', []);
		});

		it('keeps the row pending when a queued photo fails to upload, so the photo is not lost', async () => {
			const photo = new File(['jpeg'], 'receipt.jpg', { type: 'image/jpeg' });
			vi.mocked(loadOfflineExpenses).mockReturnValue([
				{
					id: 'p',
					clientId: 'cid-p',
					vehicleId: 'vehicle-1',
					tags: [],
					category: 'misc',
					amount: 9,
					date: '2024-01-01',
					timestamp: Date.now(),
					synced: false
				}
			]);
			vi.mocked(loadPendingPhotos).mockResolvedValueOnce([photo]);
			vi.mocked(expenseApi.uploadPhoto).mockRejectedValueOnce(new TypeError('Failed to fetch'));
			mockFetch.mockResolvedValueOnce(apiOk({ id: 'server-p' }));

			vi.useFakeTimers();
			try {
				const result = await syncManager.syncAll();

				expect(result.synced).toBe(0);
				expect(result.failed).toBe(1);
				expect(markExpenseAsSynced).not.toHaveBeenCalled();
				expect(savePendingPhotos).not.toHaveBeenCalled();
			} finally {
				vi.useRealTimers();
			}
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
				serverExpense: { id: 'server-1', tags: ['fuel'], amount: 45.0, date: '2024-01-01' }
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
				serverExpense: { id: 'server-1', tags: ['fuel'], amount: 45.0, date: '2024-01-01' }
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
				serverExpense: { id: 'server-1', tags: ['fuel'], amount: 45.0, date: '2024-01-01' }
			};
		}

		it('keep_local: overwrites the same server record and returns true', async () => {
			mockFetch.mockResolvedValueOnce(apiOk({ id: 'server-1' }));

			const result = await syncManager.resolveConflict(modifiedConflict(), 'keep_local');

			expect(result).toBe(true);
			const body = JSON.parse((mockFetch.mock.calls[0]![1] as { body: string }).body);
			expect(body.expenseAmount).toBe(50);
			expect(body.forceOverwrite).toBeUndefined();
			expect(body.timeZone).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
		});

		it('keep_local: a FAILED overwrite returns false (the edit survives to retry, not silently lost)', async () => {
			mockFetch.mockRejectedValueOnce(new Error('network down'));

			const result = await syncManager.resolveConflict(modifiedConflict(), 'keep_local');

			expect(result).toBe(false);
		});

		it('keep_local: an overwrite the server refuses parks the entry with the reason instead of failing silently', async () => {
			mockFetch.mockResolvedValueOnce(
				apiError(400, 'Mileage must be greater than 60,000 (from earlier entry)')
			);

			const result = await syncManager.resolveConflict(modifiedConflict(), 'keep_local');

			expect(result).toBe(true);
			expect(vi.mocked(markExpenseNeedsAttention)).toHaveBeenCalledWith(
				'c-1',
				expect.stringContaining('Mileage must be greater than 60,000')
			);
			expect(vi.mocked(markExpenseAsSynced)).not.toHaveBeenCalled();
		});

		it('keep_server: returns true WITHOUT any POST (server version wins, no overwrite sent)', async () => {
			const result = await syncManager.resolveConflict(modifiedConflict(), 'keep_server');

			expect(result).toBe(true);
			expect(mockFetch).not.toHaveBeenCalled();
		});

		it('keep_server discards only this local copy and still delivers its queued photos', async () => {
			const photo = new File(['jpeg'], 'receipt.jpg', { type: 'image/jpeg' });
			vi.mocked(loadPendingPhotos).mockResolvedValueOnce([photo]);

			const result = await syncManager.resolveConflict(modifiedConflict(), 'keep_server');

			expect(result).toBe(true);
			expect(expenseApi.uploadPhoto).toHaveBeenCalledWith('expense', 'server-1', photo);
			expect(markExpenseAsSynced).toHaveBeenCalledTimes(1);
			expect(markExpenseAsSynced).toHaveBeenCalledWith('c-1');
		});

		it('keep_local uploads queued photos to the overwritten record', async () => {
			const photo = new File(['jpeg'], 'receipt.jpg', { type: 'image/jpeg' });
			vi.mocked(loadPendingPhotos).mockResolvedValueOnce([photo]);
			mockFetch.mockResolvedValueOnce(apiOk({ id: 'server-1' }));

			await syncManager.resolveConflict(modifiedConflict(), 'keep_local');

			expect(expenseApi.uploadPhoto).toHaveBeenCalledWith('expense', 'server-1', photo);
		});

		it('keep_local PUTs the local copy onto the server record named in the conflict', async () => {
			mockFetch.mockResolvedValueOnce(apiOk({ id: 'server-1' }));

			await syncManager.resolveConflict(modifiedConflict(), 'keep_local');

			const [url, init] = mockFetch.mock.calls[0] as [string, { method: string; body: string }];
			expect(String(url)).toContain('/api/v1/expenses/server-1');
			expect(init.method).toBe('PUT');
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
					expect.stringContaining('volume/charge and mileage'),
					undefined
				);
				const RETRY_DELAYS = new Set([100, 200, 400, 800]);
				const retryScheduled = setTimeoutSpy.mock.calls.some(
					([, delay]) => typeof delay === 'number' && RETRY_DELAYS.has(delay)
				);
				expect(retryScheduled, 'a permanent failure must not schedule a retry').toBe(false);
			} finally {
				setTimeoutSpy.mockRestore();
			}
		});

		it('a fill-up whose odometer the server refuses is parked with the server message', async () => {
			const queued: OfflineExpense = {
				...malformedFuel,
				id: 'odometer-1',
				clientId: 'cid-odometer-1',
				mileage: 9000,
				volume: 10
			};
			vi.mocked(loadOfflineExpenses).mockReturnValue([queued]);
			mockFetch.mockResolvedValueOnce(
				apiError(400, 'Mileage must be greater than 10,000 (from earlier entry)')
			);

			const result = await syncManager.syncAll();

			expect(result.needsAttention).toBe(1);
			expect(vi.mocked(markExpenseNeedsAttention)).toHaveBeenCalledWith(
				'odometer-1',
				expect.stringContaining('Mileage must be greater than 10,000 (from earlier entry)'),
				undefined
			);
			expect(vi.mocked(markExpenseAsSynced)).not.toHaveBeenCalled();
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
		const RETRY_DELAYS = new Set([100, 200, 400, 800]);
		function retryTimerScheduled(spy: { mock: { calls: unknown[][] } }): boolean {
			return spy.mock.calls.some(
				([, delay]) => typeof delay === 'number' && RETRY_DELAYS.has(delay)
			);
		}

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
			mockFetch.mockResolvedValueOnce(apiError(500, 'boom'));

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
				const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
				await syncManager.syncAll();
				expect(retryTimerScheduled(setTimeoutSpy), 'the first failure schedules a retry').toBe(
					true
				);

				setTimeoutSpy.mockClear();
				await syncManager.syncAll();
				expect(
					retryTimerScheduled(setTimeoutSpy),
					'no retry-backoff timer scheduled past the cap'
				).toBe(false);
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
				mockFetch.mockResolvedValueOnce(apiError(500, 'boom'));
				await syncManager.syncAll();
				expect(syncConflicts.current).toHaveLength(0);

				mockFetch.mockResolvedValueOnce(
					apiOk({
						...serverRow('server-x', 'cid-retry-conf-1'),
						expenseAmount: 75,
						updatedAt: '2024-01-02T00:00:00.000Z'
					})
				);
				await vi.advanceTimersByTimeAsync(200);

				expect(syncConflicts.current).toHaveLength(1);
				expect(syncConflicts.current[0]?.localExpense.id).toBe('retry-conf-1');
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
				mockFetch.mockResolvedValueOnce(apiError(500, 'boom'));
				await syncManager.syncAll();

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

describe('Sync Manager — same-record conflict detection', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		onlineStatus.current = true;
		syncState.current = 'idle';
		syncConfig.current = {
			maxRetries: 3,
			retryDelay: 100,
			conflictResolution: 'ask_user'
		};
	});

	async function conflictsAgainst(
		local: Partial<OfflineExpense>,
		server: Partial<ReturnType<typeof serverRow>>
	): Promise<SyncConflict[]> {
		const localExpense: OfflineExpense = {
			id: 'local-1',
			clientId: 'cid-local-1',
			vehicleId: 'vehicle-1',
			tags: ['fuel'],
			category: 'fuel',
			amount: 50.0,
			date: '2024-01-01',
			mileage: 50000,
			volume: 10.5,
			fuelType: '87 (Regular)',
			timestamp: Date.now(),
			synced: false,
			...local
		};
		vi.mocked(loadOfflineExpenses).mockReturnValue([localExpense]);
		mockFetch.mockReset().mockResolvedValueOnce(
			apiOk({
				...serverRow('server-1', 'cid-local-1'),
				updatedAt: '2024-01-02T00:00:00.000Z',
				...server
			})
		);
		const result = await syncManager.syncAll();
		return result.conflicts;
	}

	it('an identical server copy is not a conflict', async () => {
		expect(await conflictsAgainst({}, {})).toHaveLength(0);
	});

	it('a changed amount on the server copy is a conflict', async () => {
		expect(await conflictsAgainst({}, { expenseAmount: 75 })).toHaveLength(1);
	});

	it('a changed date on the server copy is a conflict', async () => {
		expect(await conflictsAgainst({}, { date: '2024-02-01' })).toHaveLength(1);
	});

	it('a changed description on the server copy is a conflict', async () => {
		expect(await conflictsAgainst({ description: 'Costco' }, {})).toHaveLength(1);
	});

	it('an amount within the cent-rounding epsilon still matches', async () => {
		expect(await conflictsAgainst({ amount: 50.0 }, { expenseAmount: 50.004 })).toHaveLength(0);
	});

	it('a changed server copy that was never edited on the server is not a conflict', async () => {
		expect(
			await conflictsAgainst({}, { expenseAmount: 75, updatedAt: '2024-01-01T00:00:00.000Z' })
		).toHaveLength(0);
	});
});
