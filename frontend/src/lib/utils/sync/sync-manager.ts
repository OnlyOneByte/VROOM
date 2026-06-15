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
	getPendingExpenses,
	markExpenseAsSynced,
	offlineExpenseToBackend,
	type OfflineExpense
} from '../offline-storage';
import { extractErrorMessage } from '$lib/utils/error-handling';
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
			const pendingExpenses = getPendingExpenses();
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
						markExpenseAsSynced(expense.id);
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

			const backendExpense = offlineExpenseToBackend(expense);

			// Send the idempotency key so a retried POST returns the original row
			// instead of creating a duplicate.
			await apiClient.post('/api/v1/expenses', { ...backendExpense, clientId: expense.clientId });
			return { success: true };
		} catch (error) {
			return { success: false, error: extractErrorMessage(error, 'Unknown error') };
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

	private async retrySingleExpense(expense: OfflineExpense): Promise<void> {
		if (!onlineStatus.current) return;

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
				// #121 (C424): a conflict detected ON A RETRY must be SURFACED for resolution, just like the
				// main syncExpenses loop does (which pushes to result.conflicts → syncConflicts.current). The
				// realistic trigger: the first POST committed server-side but its response was lost → the
				// expense stayed pending + a retry was scheduled → on retry checkForExistingExpense now finds
				// the committed row → conflict. Without this branch the conflict was silently dropped: no
				// SyncConflictResolver dialog, the expense stuck pending, retryCount never cleared. Append
				// (don't replace) since the retry runs async AFTER syncAll returned — other conflicts may
				// already be displayed; dedup by expense id so a re-retry can't double-list it.
				this.retryCount.delete(expense.id);
				const already = syncConflicts.current.some(
					c => c.localExpense.id === result.conflict?.localExpense.id
				);
				if (!already) {
					syncConflicts.current = [...syncConflicts.current, result.conflict];
					syncState.current = 'error';
				}
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
						// NOTE (#98, escalated C324): this POSTs to the CREATE endpoint, whose
						// idempotency keys on (userId, clientId). `forceOverwrite` is NOT honored by the
						// backend (Zod strips unknown keys) — so on a GENUINE clientId collision the
						// create returns the existing row UNCHANGED and the local edit is NOT applied,
						// while we still markExpenseAsSynced + return true. It only "works" because the
						// fuzzy pre-check (checkForExistingExpense) flags DISTINCT rows whose clientId is
						// new (→ a clean insert). A real overwrite path (PUT-on-collision / upsert) is the
						// product/arch call in #98; the field is left here pending that decision, not relied on.
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
