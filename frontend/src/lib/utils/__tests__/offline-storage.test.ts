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
					category: 'operating',
					amount: 50.0,
					date: '2024-01-01',
					timestamp: Date.now(),
					synced: false
				}
			];

			localStorageMock.getItem.mockReturnValue(JSON.stringify(mockExpenses));

			const expenses = loadOfflineExpenses();
			expect(expenses).toEqual(mockExpenses);
		});

		it('should handle corrupted localStorage data gracefully', () => {
			localStorageMock.getItem.mockReturnValue('invalid json');

			const expenses = loadOfflineExpenses();
			expect(expenses).toEqual([]);
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
					category: 'operating',
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
				category: 'operating',
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
				category: 'operating',
				amount: 50.0,
				date: '2024-01-02'
			};

			addOfflineExpense(newExpenseData);

			const savedData = JSON.parse(localStorageMock.setItem.mock.calls[0][1]);
			expect(savedData).toHaveLength(2);
			expect(savedData[0]).toEqual(existingExpenses[0]);
			expect(savedData[1]).toMatchObject(newExpenseData);
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
					category: 'operating',
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
					category: 'operating',
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
					category: 'operating',
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
					category: 'operating',
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
