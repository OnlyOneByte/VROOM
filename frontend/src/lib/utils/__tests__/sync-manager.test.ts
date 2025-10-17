import { describe, it, expect, beforeEach, vi } from 'vitest';
import { syncManager, syncConfig, type SyncConflict } from '../sync-manager';
import { isOnline, syncStatus } from '../../stores/offline';
import type { OfflineExpense } from '../offline-storage';

// Mock fetch (already set up in global setup)
const mockFetch = global.fetch as any;

// Mock offline storage functions
vi.mock('../offline-storage', () => ({
	loadOfflineExpenses: vi.fn(),
	saveOfflineExpenses: vi.fn(),
	markExpenseAsSynced: vi.fn(),
	clearSyncedExpenses: vi.fn()
}));

import { loadOfflineExpenses } from '../offline-storage';

describe('Sync Manager', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		isOnline.set(true);
		syncStatus.set('idle');

		// Reset sync config
		syncConfig.set({
			maxRetries: 3,
			retryDelay: 100, // Shorter delay for tests
			batchSize: 10,
			conflictResolution: 'ask_user'
		});
	});

	describe('syncAll', () => {
		it('should throw error when offline', async () => {
			isOnline.set(false);

			await expect(syncManager.syncAll()).rejects.toThrow('Cannot sync while offline');
		});

		it('should throw error when sync already in progress', async () => {
			// Mock pending expenses
			const mockExpenses: OfflineExpense[] = [
				{
					id: 'test-1',
					vehicleId: 'vehicle-1',
					type: 'fuel',
					tags: ['fuel'],
					category: 'operating',
					amount: 50.0,
					date: '2024-01-01',
					mileage: 50000,
					volume: 10.5,
					timestamp: Date.now(),
					synced: false
				}
			];

			vi.mocked(loadOfflineExpenses).mockReturnValue(mockExpenses);
			vi.mocked(fetch).mockResolvedValue(new Response('{}', { status: 200 }));

			// Start first sync
			const firstSync = syncManager.syncAll();

			// Try to start second sync
			await expect(syncManager.syncAll()).rejects.toThrow('Sync already in progress');

			// Wait for first sync to complete
			await firstSync;
		});

		it('should successfully sync pending expenses', async () => {
			const mockExpenses: OfflineExpense[] = [
				{
					id: 'test-1',
					vehicleId: 'vehicle-1',
					type: 'fuel',
					tags: ['fuel'],
					category: 'operating',
					amount: 50.0,
					date: '2024-01-01',
					mileage: 50000,
					volume: 10.5,
					timestamp: Date.now(),
					synced: false
				}
			];

			vi.mocked(loadOfflineExpenses).mockReturnValue(mockExpenses);

			// Mock successful API response
			mockFetch.mockResolvedValueOnce(
				new Response('[]', { status: 200 }) // No existing expenses (conflict check)
			);
			mockFetch.mockResolvedValueOnce(
				new Response('{"id": "server-1"}', { status: 200 }) // Successful creation
			);

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
					type: 'fuel',
					tags: ['fuel'],
					category: 'operating',
					amount: 50.0,
					date: '2024-01-01',
					mileage: 50000,
					volume: 10.5,
					timestamp: Date.now(),
					synced: false
				}
			];

			vi.mocked(loadOfflineExpenses).mockReturnValue(mockExpenses);

			// Mock API error
			mockFetch.mockResolvedValueOnce(
				new Response('[]', { status: 200 }) // No existing expenses
			);
			mockFetch.mockResolvedValueOnce(
				new Response('Server Error', { status: 500 }) // Failed creation
			);

			const result = await syncManager.syncAll();

			expect(result.success).toBe(false);
			expect(result.synced).toBe(0);
			expect(result.failed).toBe(1);
			expect(result.errors).toContain('HTTP 500: Server Error');
		});

		it('should detect and report conflicts', async () => {
			const mockExpenses: OfflineExpense[] = [
				{
					id: 'test-1',
					vehicleId: 'vehicle-1',
					type: 'fuel',
					tags: ['fuel'],
					category: 'operating',
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
				category: 'operating',
				amount: 50.0,
				date: '2024-01-01'
			};

			vi.mocked(loadOfflineExpenses).mockReturnValue(mockExpenses);

			// Mock existing expense found (conflict)
			mockFetch.mockResolvedValueOnce(
				new Response(JSON.stringify([existingExpense]), { status: 200 })
			);

			const result = await syncManager.syncAll();

			expect(result.success).toBe(false);
			expect(result.synced).toBe(0);
			expect(result.failed).toBe(0);
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
					type: 'fuel',
					tags: ['fuel'],
					category: 'operating',
					amount: 50.0,
					date: '2024-01-01',
					mileage: 50000,
					volume: 10.5,
					timestamp: Date.now(),
					synced: false
				},
				serverExpense: {
					tags: ['fuel'],
					amount: 45.0,
					date: '2024-01-01'
				},
				conflictType: 'modified'
			};

			// Mock successful force overwrite
			mockFetch.mockResolvedValueOnce(new Response('{"id": "server-1"}', { status: 200 }));

			const result = await syncManager.resolveConflict(conflict, 'keep_local');

			expect(result).toBe(true);
			expect(fetch).toHaveBeenCalledWith(
				expect.stringContaining('/api/expenses'),
				expect.objectContaining({
					method: 'POST',
					body: expect.stringContaining('"forceOverwrite":true')
				})
			);
		});

		it('should resolve conflict by keeping server version', async () => {
			const conflict: SyncConflict = {
				id: 'test-1',
				localExpense: {
					id: 'test-1',
					vehicleId: 'vehicle-1',
					type: 'fuel',
					tags: ['fuel'],
					category: 'operating',
					amount: 50.0,
					date: '2024-01-01',
					mileage: 50000,
					volume: 10.5,
					timestamp: Date.now(),
					synced: false
				},
				serverExpense: {
					tags: ['fuel'],
					amount: 45.0,
					date: '2024-01-01'
				},
				conflictType: 'duplicate'
			};

			const result = await syncManager.resolveConflict(conflict, 'keep_server');

			expect(result).toBe(true);
			// Should not make any API calls, just mark as synced
			expect(fetch).not.toHaveBeenCalled();
		});
	});

	describe('retry mechanism', () => {
		it('should retry failed syncs with exponential backoff', async () => {
			const mockExpenses: OfflineExpense[] = [
				{
					id: 'test-1',
					vehicleId: 'vehicle-1',
					type: 'fuel',
					tags: ['fuel'],
					category: 'operating',
					amount: 50.0,
					date: '2024-01-01',
					mileage: 50000,
					volume: 10.5,
					timestamp: Date.now(),
					synced: false
				}
			];

			vi.mocked(loadOfflineExpenses).mockReturnValue(mockExpenses);

			// Mock conflict check (no existing expenses)
			mockFetch.mockResolvedValue(new Response('[]', { status: 200 }));

			// Mock failed creation
			mockFetch.mockResolvedValue(new Response('Server Error', { status: 500 }));

			const result = await syncManager.syncAll();

			expect(result.failed).toBe(1);
			expect(syncManager.getRetryCount('test-1')).toBe(2);
		});

		it('should stop retrying after max retries reached', async () => {
			// Set low retry count for test
			syncConfig.update(config => ({ ...config, maxRetries: 1 }));

			const mockExpenses: OfflineExpense[] = [
				{
					id: 'test-1',
					vehicleId: 'vehicle-1',
					type: 'fuel',
					tags: ['fuel'],
					category: 'operating',
					amount: 50.0,
					date: '2024-01-01',
					mileage: 50000,
					volume: 10.5,
					timestamp: Date.now(),
					synced: false
				}
			];

			vi.mocked(loadOfflineExpenses).mockReturnValue(mockExpenses);

			// Mock failed responses
			mockFetch.mockResolvedValue(new Response('Server Error', { status: 500 }));

			// First sync attempt
			await syncManager.syncAll();
			expect(syncManager.getRetryCount('test-1')).toBe(2);

			// Second sync attempt (should not increment retry count beyond max)
			await syncManager.syncAll();
			expect(syncManager.getRetryCount('test-1')).toBe(2);
		});
	});
});
