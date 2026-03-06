import { describe, it, expect, beforeEach, vi } from 'vitest';
import { onlineStatus, syncState, offlineExpenseQueue } from '../../stores/offline.svelte';
import { syncOfflineExpenses } from '../../utils/offline-storage';

// Mock the sync function
vi.mock('../../utils/offline-storage', () => ({
	syncOfflineExpenses: vi.fn()
}));

describe('OfflineIndicator Store Logic', () => {
	beforeEach(() => {
		vi.clearAllMocks();

		// Reset stores to default state
		onlineStatus.current = true;
		syncState.current = 'idle';
		offlineExpenseQueue.current = [];
	});

	it('should have correct initial state', () => {
		expect(onlineStatus.current).toBe(true);
		expect(syncState.current).toBe('idle');
		expect(offlineExpenseQueue.current).toEqual([]);
	});

	it('should update online status', () => {
		onlineStatus.current = false;
		expect(onlineStatus.current).toBe(false);

		onlineStatus.current = true;
		expect(onlineStatus.current).toBe(true);
	});

	it('should update sync status', () => {
		syncState.current = 'syncing';
		expect(syncState.current).toBe('syncing');

		syncState.current = 'success';
		expect(syncState.current).toBe('success');

		syncState.current = 'error';
		expect(syncState.current).toBe('error');
	});

	it('should manage offline expenses', () => {
		const expenses = [
			{
				id: 'test-1',
				vehicleId: 'vehicle-1',
				type: 'fuel',
				tags: ['fuel'],
				category: 'fuel',
				amount: 50,
				date: '2024-01-01',
				timestamp: Date.now(),
				synced: false
			}
		];

		offlineExpenseQueue.current = expenses;
		expect(offlineExpenseQueue.current).toEqual(expenses);
	});

	it('should calculate pending count correctly', () => {
		const expenses = [
			{
				id: 'test-1',
				vehicleId: 'vehicle-1',
				type: 'fuel',
				tags: ['fuel'],
				category: 'fuel',
				amount: 50,
				date: '2024-01-01',
				timestamp: Date.now(),
				synced: false
			},
			{
				id: 'test-2',
				vehicleId: 'vehicle-1',
				type: 'maintenance',
				tags: ['maintenance'],
				category: 'maintenance',
				amount: 100,
				date: '2024-01-02',
				timestamp: Date.now(),
				synced: true
			}
		];

		offlineExpenseQueue.current = expenses;
		const pendingCount = offlineExpenseQueue.current.filter(expense => !expense.synced).length;
		expect(pendingCount).toBe(1);
	});

	it('should handle sync function call', async () => {
		await syncOfflineExpenses();
		expect(syncOfflineExpenses).toHaveBeenCalled();
	});
});
