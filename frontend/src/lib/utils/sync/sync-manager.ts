import { onlineStatus, syncState, offlineExpenseQueue } from '$lib/stores/offline.svelte';
import {
	syncConfig,
	syncConflicts,
	lastSyncTime,
	lastBackupTime,
	lastSheetsSync,
	lastDataChangeTime,
	backupEnabled,
	sheetsSyncEnabled,
	type SyncConflict,
	type SyncConfig
} from './sync-state.svelte';
import { loadOfflineExpenses, saveOfflineExpenses, type OfflineExpense } from '../offline-storage';
import type { ExpenseCategory } from '$lib/types';
import { toBackendExpense } from '$lib/services/api-transformer';
import { apiClient } from '$lib/services/api-client';
import { browser } from '$app/environment';

// Re-export types and state for consumers
export type { SyncConflict, SyncConfig };
export {
	syncConfig,
	syncConflicts,
	lastSyncTime,
	lastBackupTime,
	lastSheetsSync,
	lastDataChangeTime,
	backupEnabled,
	sheetsSyncEnabled
};

interface SyncResult {
	success: boolean;
	synced: number;
	failed: number;
	conflicts: SyncConflict[];
	errors: string[];
}

// Fetch last sync time from server
export async function fetchLastSyncTime(): Promise<void> {
	try {
		const result = await apiClient.get<{
			lastSyncDate?: string;
			lastBackupDate?: string;
			lastDataChangeDate?: string;
			sheetsSyncEnabled?: boolean;
			backupEnabled?: boolean;
		}>('/api/v1/sync/status');

		if (result) {
			const syncDate = result.lastSyncDate ? new Date(result.lastSyncDate) : null;
			const backupDate = result.lastBackupDate ? new Date(result.lastBackupDate) : null;
			const changeDate = result.lastDataChangeDate ? new Date(result.lastDataChangeDate) : null;

			lastSheetsSync.current = syncDate;
			lastBackupTime.current = backupDate;
			lastDataChangeTime.current = changeDate;
			sheetsSyncEnabled.current = result.sheetsSyncEnabled || false;
			backupEnabled.current = result.backupEnabled || false;

			let mostRecentSync: Date | null = null;
			if (syncDate && backupDate) {
				mostRecentSync = syncDate > backupDate ? syncDate : backupDate;
			} else if (syncDate) {
				mostRecentSync = syncDate;
			} else if (backupDate) {
				mostRecentSync = backupDate;
			}

			if (mostRecentSync) {
				lastSyncTime.current = mostRecentSync;
			}
		}
	} catch (error) {
		if (import.meta.env.DEV) console.error('Failed to fetch last sync time:', error);
	}
}

class SyncManager {
	private retryCount = new Map<string, number>();
	private syncInProgress = false;
	private autoSyncSetup = false;

	async syncAll(): Promise<SyncResult> {
		if (this.syncInProgress) {
			throw new Error('Sync already in progress');
		}

		if (!onlineStatus.current) {
			throw new Error('Cannot sync while offline');
		}

		this.syncInProgress = true;
		syncState.current = 'syncing';

		try {
			const pendingExpenses = this.getPendingExpenses();
			const result = await this.syncExpenses(pendingExpenses);

			if (result.success && result.conflicts.length === 0) {
				lastSyncTime.current = new Date();
				syncState.current = 'success';
			} else if (result.conflicts.length > 0) {
				syncConflicts.current = result.conflicts;
				syncState.current = 'error';
			} else {
				syncState.current = 'error';
			}

			setTimeout(() => {
				if (syncState.current !== 'syncing') {
					syncState.current = 'idle';
				}
			}, 3000);

			return result;
		} finally {
			this.syncInProgress = false;
		}
	}

	private getPendingExpenses(): OfflineExpense[] {
		return loadOfflineExpenses().filter(expense => !expense.synced);
	}

	private async syncExpenses(expenses: OfflineExpense[]): Promise<SyncResult> {
		const result: SyncResult = {
			success: true,
			synced: 0,
			failed: 0,
			conflicts: [],
			errors: []
		};

		const config = syncConfig.current;

		for (let i = 0; i < expenses.length; i += config.batchSize) {
			const batch = expenses.slice(i, i + config.batchSize);

			for (const expense of batch) {
				try {
					const syncResult = await this.syncSingleExpense(expense);

					if (syncResult.success) {
						result.synced++;
						this.markExpenseAsSynced(expense.id);
						this.retryCount.delete(expense.id);
					} else if (syncResult.conflict) {
						result.conflicts.push(syncResult.conflict);
					} else {
						result.failed++;
						result.errors.push(syncResult.error || 'Unknown error');

						const retries = this.retryCount.get(expense.id) || 0;
						if (retries < config.maxRetries) {
							this.retryCount.set(expense.id, retries + 1);
							setTimeout(
								() => {
									this.retrySingleExpense(expense);
								},
								config.retryDelay * Math.pow(2, retries)
							);
						}
					}
				} catch (error) {
					result.failed++;
					result.errors.push(`Failed to sync expense ${expense.id}: ${error}`);
				}
			}
		}

		result.success = result.failed === 0 && result.conflicts.length === 0;
		return result;
	}

	private async syncSingleExpense(expense: OfflineExpense): Promise<{
		success: boolean;
		conflict?: SyncConflict;
		error?: string;
	}> {
		try {
			const existingExpense = await this.checkForExistingExpense(expense);

			if (existingExpense) {
				const conflict: SyncConflict = {
					id: expense.id,
					localExpense: expense,
					serverExpense: existingExpense,
					conflictType: this.determineConflictType(expense, existingExpense)
				};
				return { success: false, conflict };
			}

			if (
				expense.category === 'fuel' &&
				((!expense.volume && !expense.charge) || !expense.mileage)
			) {
				return {
					success: false,
					error:
						'Fuel expenses require volume/charge and mileage data. Please edit the expense and add the missing information.'
				};
			}

			const backendExpense = toBackendExpense({
				vehicleId: expense.vehicleId,
				tags: expense.tags,
				category: expense.category as ExpenseCategory,
				amount: expense.amount,
				date: expense.date,
				mileage: expense.mileage,
				volume: expense.volume,
				charge: expense.charge,
				description: expense.description
			});

			await apiClient.post('/api/v1/expenses', backendExpense);
			return { success: true };
		} catch (error) {
			return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
		}
	}

	private async checkForExistingExpense(
		expense: OfflineExpense
	): Promise<{ date: string; amount: number; tags: string[] } | null> {
		try {
			const expenses = await apiClient.get<Array<{ date: string; amount: number; tags: string[] }>>(
				`/api/v1/expenses?vehicleId=${expense.vehicleId}&date=${expense.date}&amount=${expense.amount}`
			);
			const expenseList = Array.isArray(expenses) ? expenses : [];
			return (
				expenseList.find(existing => expense.tags.some(tag => existing.tags?.includes(tag))) || null
			);
		} catch (error) {
			if (import.meta.env.DEV) console.warn('Failed to check for existing expense:', error);
			return null;
		}
	}

	private determineConflictType(
		local: OfflineExpense,
		server: { amount: number; tags: string[]; date: string }
	): SyncConflict['conflictType'] {
		const tagsMatch = local.tags.some(tag => server.tags?.includes(tag));
		const amountMatch = Math.abs(local.amount - server.amount) < 0.01;
		const dateMatch = local.date === server.date;
		return amountMatch && tagsMatch && dateMatch ? 'duplicate' : 'modified';
	}

	private markExpenseAsSynced(expenseId: string): void {
		const expenses = loadOfflineExpenses();
		const updatedExpenses = expenses.map(expense =>
			expense.id === expenseId ? { ...expense, synced: true } : expense
		);
		saveOfflineExpenses(updatedExpenses);
	}

	private async retrySingleExpense(expense: OfflineExpense): Promise<void> {
		if (!onlineStatus.current) return;

		try {
			const result = await this.syncSingleExpense(expense);
			if (result.success) {
				this.markExpenseAsSynced(expense.id);
				this.retryCount.delete(expense.id);
				const currentExpenses = offlineExpenseQueue.current;
				offlineExpenseQueue.current = currentExpenses.map(e =>
					e.id === expense.id ? { ...e, synced: true } : e
				);
			}
		} catch (error) {
			if (import.meta.env.DEV) console.error('Retry failed for expense:', expense.id, error);
		}
	}

	async resolveConflict(
		conflict: SyncConflict,
		resolution: 'keep_local' | 'keep_server' | 'merge'
	): Promise<boolean> {
		try {
			switch (resolution) {
				case 'keep_local': {
					const backendExpense = toBackendExpense({
						vehicleId: conflict.localExpense.vehicleId,
						tags: conflict.localExpense.tags,
						category: conflict.localExpense.category as ExpenseCategory,
						amount: conflict.localExpense.amount,
						date: conflict.localExpense.date,
						mileage: conflict.localExpense.mileage,
						volume: conflict.localExpense.volume,
						charge: conflict.localExpense.charge,
						description: conflict.localExpense.description
					});
					try {
						await apiClient.post('/api/v1/expenses', {
							...backendExpense,
							forceOverwrite: true
						});
						this.markExpenseAsSynced(conflict.localExpense.id);
						return true;
					} catch {
						break;
					}
				}
				case 'keep_server':
					this.markExpenseAsSynced(conflict.localExpense.id);
					return true;
				case 'merge':
					return await this.resolveConflict(conflict, 'keep_local');
			}
		} catch (error) {
			if (import.meta.env.DEV) console.error('Failed to resolve conflict:', error);
		}
		return false;
	}

	async clearSyncedExpenses(): Promise<void> {
		const expenses = loadOfflineExpenses();
		const pendingExpenses = expenses.filter(expense => !expense.synced);
		saveOfflineExpenses(pendingExpenses);
	}

	getRetryCount(expenseId: string): number {
		return this.retryCount.get(expenseId) || 0;
	}

	setupAutoSync(): void {
		if (this.autoSyncSetup) return;
		this.autoSyncSetup = true;

		fetchLastSyncTime();

		if (browser) {
			window.addEventListener('online', () => {
				if (!this.syncInProgress) {
					fetchLastSyncTime();
					const pendingExpenses = this.getPendingExpenses();
					if (pendingExpenses.length > 0) {
						setTimeout(() => {
							this.syncAll().catch(error => {
								if (import.meta.env.DEV) console.error('Auto-sync failed:', error);
							});
						}, 2000);
					}
				}
			});
		}
	}
}

export const syncManager = new SyncManager();
