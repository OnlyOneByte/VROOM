import { describe, it, expect, beforeEach, vi } from 'vitest';
import { get } from 'svelte/store';
import { isOnline, syncStatus, offlineExpenses } from '../../stores/offline';
import { syncOfflineExpenses } from '../../utils/offline-storage';

// Mock the sync function
vi.mock('../../utils/offline-storage', () => ({
	syncOfflineExpenses: vi.fn()
}));

describe('OfflineIndicator Store Logic', () => {
	beforeEach(() => {
		vi.clearAllMocks();

		// Reset stores to default state
		isOnline.set(true);
		syncStatus.set('idle');
		offlineExpenses.set([]);
	});

	it('should have correct initial state', () => {
		expect(get(isOnline)).toBe(true);
		expect(get(syncStatus)).toBe('idle');
		expect(get(offlineExpenses)).toEqual([]);
	});

	it('should update online status', () => {
		isOnline.set(false);
		expect(get(isOnline)).toBe(false);

		isOnline.set(true);
		expect(get(isOnline)).toBe(true);
	});

	it('should update sync status', () => {
		syncStatus.set('syncing');
		expect(get(syncStatus)).toBe('syncing');

		syncStatus.set('success');
		expect(get(syncStatus)).toBe('success');

		syncStatus.set('error');
		expect(get(syncStatus)).toBe('error');
	});

	it('should manage offline expenses', () => {
		const expenses = [
			{
				id: 'test-1',
				vehicleId: 'vehicle-1',
				type: 'fuel',
				tags: ['fuel'],
				category: 'operating',
				amount: 50,
				date: '2024-01-01',
				timestamp: Date.now(),
				synced: false
			}
		];

		offlineExpenses.set(expenses);
		expect(get(offlineExpenses)).toEqual(expenses);
	});

	it('should calculate pending count correctly', () => {
		const expenses = [
			{
				id: 'test-1',
				vehicleId: 'vehicle-1',
				type: 'fuel',
				tags: ['fuel'],
				category: 'operating',
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

		offlineExpenses.set(expenses);
		const pendingCount = get(offlineExpenses).filter(expense => !expense.synced).length;
		expect(pendingCount).toBe(1);
	});

	it('should handle sync function call', async () => {
		await syncOfflineExpenses();
		expect(syncOfflineExpenses).toHaveBeenCalled();
	});
});
