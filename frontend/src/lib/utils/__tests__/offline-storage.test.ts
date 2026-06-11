import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
	addOfflineExpense,
	loadOfflineExpenses,
	saveOfflineExpenses,
	removeOfflineExpense,
	getPendingExpenses,
	markExpenseAsSynced,
	clearSyncedExpenses,
	type OfflineExpense
} from '../offline-storage';

// Get localStorage mock from global setup
const localStorageMock = window.localStorage as any;

describe('Offline Storage', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		localStorageMock.getItem.mockReturnValue(null);
	});

	describe('loadOfflineExpenses', () => {
		it('should return empty array when no data exists', () => {
			const expenses = loadOfflineExpenses();
			expect(expenses).toEqual([]);
		});

		it('should return parsed expenses from localStorage', () => {
			const mockExpenses: OfflineExpense[] = [
				{
					id: 'test-1',
					vehicleId: 'vehicle-1',
					type: 'fuel',
					tags: ['fuel'],
					category: 'fuel',
					amount: 50.0,
					date: '2024-01-01',
					timestamp: Date.now(),
					synced: false
				}
			];

			localStorageMock.getItem.mockReturnValue(JSON.stringify(mockExpenses));

			const expenses = loadOfflineExpenses();
			// Expenses should have version bumped and a clientId backfilled on migration
			expect(expenses).toHaveLength(1);
			const migrated = expenses[0];
			if (!migrated) throw new Error('expected one migrated expense');
			expect(migrated).toMatchObject({ ...mockExpenses[0], version: '3.0' });
			expect(typeof migrated.clientId).toBe('string');
			expect((migrated.clientId ?? '').length).toBeGreaterThan(0);
		});

		it('should handle corrupted localStorage data gracefully', () => {
			localStorageMock.getItem.mockReturnValue('invalid json');

			const expenses = loadOfflineExpenses();
			expect(expenses).toEqual([]);
		});

		it('backfills a legacy clientId DETERMINISTICALLY — stable across repeated reads (idempotency-key bug)', () => {
			// A pre-v3 entry has no clientId. The migration must mint a STABLE key, because
			// loadOfflineExpenses runs on every read of a not-yet-persisted legacy entry — a random
			// UUID fallback would produce a DIFFERENT clientId each read, so a retried sync POST
			// (after a lost response) carries a fresh key the server can't dedup → a duplicate
			// expense row (NORTH_STAR #1, offline data safety). The clientId is the offline POST's
			// idempotency key (offline-storage.ts:160 / sync-manager.ts:222).
			const legacy: OfflineExpense[] = [
				{
					id: 'legacy-entry-1',
					vehicleId: 'vehicle-1',
					tags: ['fuel'],
					category: 'fuel',
					amount: 42.0,
					date: '2024-01-01',
					timestamp: Date.now(),
					synced: false
					// no version, no clientId → pre-v3
				}
			];
			localStorageMock.getItem.mockReturnValue(JSON.stringify(legacy));

			const first = loadOfflineExpenses()[0];
			const second = loadOfflineExpenses()[0];

			expect(first?.clientId).toBeTruthy();
			// The load-bearing invariant: the SAME stored entry yields the SAME clientId every read.
			expect(second?.clientId).toBe(first?.clientId);
			expect(second?.version).toBe('3.0');
		});

		it('preserves an existing clientId on migration (never re-mints over a real key)', () => {
			const withKey: OfflineExpense[] = [
				{
					id: 'legacy-entry-2',
					clientId: 'already-assigned-key',
					vehicleId: 'vehicle-1',
					tags: ['maintenance'],
					category: 'maintenance',
					amount: 99.0,
					date: '2024-02-01',
					timestamp: Date.now(),
					synced: false
					// version absent → still triggers the migration branch
				}
			];
			localStorageMock.getItem.mockReturnValue(JSON.stringify(withKey));

			const migrated = loadOfflineExpenses()[0];
			expect(migrated?.clientId).toBe('already-assigned-key');
			expect(migrated?.version).toBe('3.0');
		});
	});

	describe('saveOfflineExpenses', () => {
		it('should save expenses to localStorage', () => {
			const mockExpenses: OfflineExpense[] = [
				{
					id: 'test-1',
					vehicleId: 'vehicle-1',
					type: 'fuel',
					tags: ['fuel'],
					category: 'fuel',
					amount: 50.0,
					date: '2024-01-01',
					timestamp: Date.now(),
					synced: false
				}
			];

			saveOfflineExpenses(mockExpenses);

			expect(localStorageMock.setItem).toHaveBeenCalledWith(
				'vroom_offline_expenses',
				JSON.stringify(mockExpenses)
			);
		});
	});

	describe('addOfflineExpense', () => {
		it('should add new expense with generated ID and timestamp', () => {
			const expenseData = {
				vehicleId: 'vehicle-1',
				type: 'fuel',
				tags: ['fuel'],
				category: 'fuel',
				amount: 50.0,
				date: '2024-01-01'
			};

			addOfflineExpense(expenseData);

			expect(localStorageMock.setItem).toHaveBeenCalled();
			const savedData = JSON.parse(localStorageMock.setItem.mock.calls[0][1]);

			expect(savedData).toHaveLength(1);
			expect(savedData[0]).toMatchObject({
				...expenseData,
				synced: false
			});
			expect(savedData[0].id).toMatch(/^offline_\d+_[a-z0-9]+$/);
			expect(savedData[0].timestamp).toBeTypeOf('number');
		});

		it('persists fuelType into the outbox so an electric charge survives sync (#66)', () => {
			// The sync transform (toBackendExpense) routes charge→volume ONLY when fuelType is
			// electric; if the outbox drops fuelType, an offline electric charging expense syncs
			// with no energy value (NORTH_STAR #1/#2). addOfflineExpense MUST carry it.
			addOfflineExpense({
				vehicleId: 'vehicle-1',
				tags: ['fuel'],
				category: 'fuel',
				amount: 30.0,
				date: '2024-03-01',
				charge: 42,
				fuelType: 'Electric'
			});

			const savedData = JSON.parse(localStorageMock.setItem.mock.calls[0][1]);
			expect(savedData[0].fuelType).toBe('Electric');
			expect(savedData[0].charge).toBe(42);
		});

		it('should append to existing expenses', () => {
			const existingExpenses: OfflineExpense[] = [
				{
					id: 'existing-1',
					vehicleId: 'vehicle-1',
					type: 'maintenance',
					tags: ['maintenance'],
					category: 'maintenance',
					amount: 100.0,
					date: '2024-01-01',
					timestamp: Date.now() - 1000,
					synced: false
				}
			];

			localStorageMock.getItem.mockReturnValue(JSON.stringify(existingExpenses));

			const newExpenseData = {
				vehicleId: 'vehicle-2',
				type: 'fuel',
				tags: ['fuel'],
				category: 'fuel',
				amount: 50.0,
				date: '2024-01-02'
			};

			addOfflineExpense(newExpenseData);

			const savedData = JSON.parse(localStorageMock.setItem.mock.calls[0][1]);
			expect(savedData).toHaveLength(2);
			// Existing entry is migrated: version bumped + clientId backfilled.
			expect(savedData[0]).toMatchObject({ ...existingExpenses[0], version: '3.0' });
			expect(typeof savedData[0].clientId).toBe('string');
			expect(savedData[1]).toMatchObject(newExpenseData);
			expect(typeof savedData[1].clientId).toBe('string');
		});
	});

	describe('getPendingExpenses', () => {
		it('should return only unsynced expenses', () => {
			const mockExpenses: OfflineExpense[] = [
				{
					id: 'synced-1',
					vehicleId: 'vehicle-1',
					type: 'fuel',
					tags: ['fuel'],
					category: 'fuel',
					amount: 50.0,
					date: '2024-01-01',
					timestamp: Date.now(),
					synced: true
				},
				{
					id: 'pending-1',
					vehicleId: 'vehicle-1',
					type: 'maintenance',
					tags: ['maintenance'],
					category: 'maintenance',
					amount: 100.0,
					date: '2024-01-02',
					timestamp: Date.now(),
					synced: false
				}
			];

			localStorageMock.getItem.mockReturnValue(JSON.stringify(mockExpenses));

			const pending = getPendingExpenses();
			expect(pending).toHaveLength(1);
			expect(pending[0]?.id).toBe('pending-1');
		});
	});

	describe('markExpenseAsSynced', () => {
		it('should mark specific expense as synced', () => {
			const mockExpenses: OfflineExpense[] = [
				{
					id: 'expense-1',
					vehicleId: 'vehicle-1',
					type: 'fuel',
					tags: ['fuel'],
					category: 'fuel',
					amount: 50.0,
					date: '2024-01-01',
					timestamp: Date.now(),
					synced: false
				},
				{
					id: 'expense-2',
					vehicleId: 'vehicle-1',
					type: 'maintenance',
					tags: ['maintenance'],
					category: 'maintenance',
					amount: 100.0,
					date: '2024-01-02',
					timestamp: Date.now(),
					synced: false
				}
			];

			localStorageMock.getItem.mockReturnValue(JSON.stringify(mockExpenses));

			markExpenseAsSynced('expense-1');

			const savedData = JSON.parse(localStorageMock.setItem.mock.calls[0][1]);
			expect(savedData[0].synced).toBe(true);
			expect(savedData[1].synced).toBe(false);
		});
	});

	describe('clearSyncedExpenses', () => {
		it('should remove synced expenses and keep pending ones', () => {
			const mockExpenses: OfflineExpense[] = [
				{
					id: 'synced-1',
					vehicleId: 'vehicle-1',
					type: 'fuel',
					tags: ['fuel'],
					category: 'fuel',
					amount: 50.0,
					date: '2024-01-01',
					timestamp: Date.now(),
					synced: true
				},
				{
					id: 'pending-1',
					vehicleId: 'vehicle-1',
					type: 'maintenance',
					tags: ['maintenance'],
					category: 'maintenance',
					amount: 100.0,
					date: '2024-01-02',
					timestamp: Date.now(),
					synced: false
				}
			];

			localStorageMock.getItem.mockReturnValue(JSON.stringify(mockExpenses));

			clearSyncedExpenses();

			const savedData = JSON.parse(localStorageMock.setItem.mock.calls[0][1]);
			expect(savedData).toHaveLength(1);
			expect(savedData[0].id).toBe('pending-1');
		});
	});

	describe('removeOfflineExpense', () => {
		it('should remove specific expense by ID', () => {
			const mockExpenses: OfflineExpense[] = [
				{
					id: 'expense-1',
					vehicleId: 'vehicle-1',
					type: 'fuel',
					tags: ['fuel'],
					category: 'fuel',
					amount: 50.0,
					date: '2024-01-01',
					timestamp: Date.now(),
					synced: false
				},
				{
					id: 'expense-2',
					vehicleId: 'vehicle-1',
					type: 'maintenance',
					tags: ['maintenance'],
					category: 'maintenance',
					amount: 100.0,
					date: '2024-01-02',
					timestamp: Date.now(),
					synced: false
				}
			];

			localStorageMock.getItem.mockReturnValue(JSON.stringify(mockExpenses));

			removeOfflineExpense('expense-1');

			const savedData = JSON.parse(localStorageMock.setItem.mock.calls[0][1]);
			expect(savedData).toHaveLength(1);
			expect(savedData[0].id).toBe('expense-2');
		});
	});
});
