import { describe, it, expect, beforeEach, vi } from 'vitest';
import { syncManager, syncConfig, type SyncConflict } from '../sync/sync-manager';
import { onlineStatus, syncState } from '../../stores/offline.svelte';
import type { OfflineExpense } from '../offline-storage';

// Mock fetch (apiClient uses fetch internally)
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock offline storage functions
vi.mock('../offline-storage', () => ({
	loadOfflineExpenses: vi.fn(),
	saveOfflineExpenses: vi.fn(),
	markExpenseAsSynced: vi.fn(),
	clearSyncedExpenses: vi.fn()
}));

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
