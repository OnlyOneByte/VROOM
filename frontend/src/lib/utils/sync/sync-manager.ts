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
import {
	clearSyncedExpenses,
	getPendingExpenses,
	INCOMPLETE_FUEL_REASON,
	isIncompleteFuelExpense,
	markExpenseAsSynced,
	markExpenseNeedsAttention,
	offlineExpenseToBackend,
	type OfflineExpense
} from '../offline-storage';
import { extractErrorMessage } from '$lib/utils/error-handling';
import { classifySyncFailure, type SyncFailureKind } from './classify-failure';
import { apiClient } from '$lib/services/api-client';
import { type BackendExpenseResponse, fromBackendExpense } from '$lib/services/api-transformer';
import { browser } from '$app/environment';

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
	needsAttention: number;
	conflicts: SyncConflict[];
	errors: string[];
}

export { classifySyncFailure, type SyncFailureKind } from './classify-failure';

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
			const pendingExpenses = getPendingExpenses();
			const result = await this.syncExpenses(pendingExpenses);

			clearSyncedExpenses();

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

	private async syncExpenses(expenses: OfflineExpense[]): Promise<SyncResult> {
		const result: SyncResult = {
			success: true,
			synced: 0,
			failed: 0,
			needsAttention: 0,
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
						markExpenseAsSynced(expense.id);
						this.retryCount.delete(expense.id);
					} else if (syncResult.conflict) {
						result.conflicts.push(syncResult.conflict);
					} else if (syncResult.failureKind === 'terminal') {
						const reason = syncResult.error || 'Entry needs attention';
						markExpenseNeedsAttention(expense.id, reason);
						this.retryCount.delete(expense.id);
						result.needsAttention++;
						result.errors.push(reason);
					} else if (syncResult.failureKind === 'auth') {
						result.failed++;
						result.errors.push(syncResult.error || 'Sign in to sync this entry');
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
		failureKind?: SyncFailureKind;
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

			if (isIncompleteFuelExpense(expense)) {
				return { success: false, failureKind: 'terminal', error: INCOMPLETE_FUEL_REASON };
			}

			const backendExpense = offlineExpenseToBackend(expense);

			await apiClient.post('/api/v1/expenses', { ...backendExpense, clientId: expense.clientId });
			return { success: true };
		} catch (error) {
			return {
				success: false,
				failureKind: classifySyncFailure(error),
				error: extractErrorMessage(error, 'Unknown error')
			};
		}
	}

	private async checkForExistingExpense(
		expense: OfflineExpense
	): Promise<{ date: string; amount: number; tags: string[] } | null> {
		try {
			const filters = new URLSearchParams({
				vehicleId: expense.vehicleId,
				startDate: expense.date.slice(0, 10),
				endDate: expense.date.slice(0, 10)
			});
			const rows = await apiClient.get<BackendExpenseResponse[]>(
				`/api/v1/expenses?${filters.toString()}`
			);
			const expenseList = Array.isArray(rows) ? rows.map(fromBackendExpense) : [];
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

	private async retrySingleExpense(expense: OfflineExpense): Promise<void> {
		if (!onlineStatus.current) return;

		if (!getPendingExpenses().some(e => e.id === expense.id)) return;

		try {
			const result = await this.syncSingleExpense(expense);
			if (result.success) {
				markExpenseAsSynced(expense.id);
				this.retryCount.delete(expense.id);
				const currentExpenses = offlineExpenseQueue.current;
				offlineExpenseQueue.current = currentExpenses.map(e =>
					e.id === expense.id ? { ...e, synced: true } : e
				);
			} else if (result.conflict) {
				this.retryCount.delete(expense.id);
				const already = syncConflicts.current.some(
					c => c.localExpense.id === result.conflict?.localExpense.id
				);
				if (!already) {
					syncConflicts.current = [...syncConflicts.current, result.conflict];
					syncState.current = 'error';
				}
			} else if (result.failureKind === 'terminal') {
				markExpenseNeedsAttention(expense.id, result.error || 'Entry needs attention');
				this.retryCount.delete(expense.id);
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
					const backendExpense = offlineExpenseToBackend(conflict.localExpense);
					try {
						await apiClient.post('/api/v1/expenses', {
							...backendExpense,
							clientId: conflict.localExpense.clientId,
							forceOverwrite: true
						});
						markExpenseAsSynced(conflict.localExpense.id);
						return true;
					} catch {
						break;
					}
				}
				case 'keep_server':
					markExpenseAsSynced(conflict.localExpense.id);
					return true;
				case 'merge':
					return await this.resolveConflict(conflict, 'keep_local');
			}
		} catch (error) {
			if (import.meta.env.DEV) console.error('Failed to resolve conflict:', error);
		}
		return false;
	}

	getRetryCount(expenseId: string): number {
		return this.retryCount.get(expenseId) || 0;
	}

	setupAutoSync(): void {
		if (this.autoSyncSetup) return;
		this.autoSyncSetup = true;

		fetchLastSyncTime();

		if (browser) {
			if (onlineStatus.current && getPendingExpenses().length > 0) {
				setTimeout(() => {
					this.syncAll().catch(error => {
						if (import.meta.env.DEV) console.error('Startup sync failed:', error);
					});
				}, 2000);
			}

			window.addEventListener('online', () => {
				if (!this.syncInProgress) {
					fetchLastSyncTime();
					const pendingExpenses = getPendingExpenses();
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
