import { writable, get } from 'svelte/store';
import { isOnline, syncStatus, offlineExpenses } from '$lib/stores/offline';
import { loadOfflineExpenses, saveOfflineExpenses, type OfflineExpense } from './offline-storage';

export interface SyncConflict {
	id: string;
	localExpense: OfflineExpense;
	serverExpense?: {
		date: string;
		amount: number;
		tags: string[];
		category?: string;
		description?: string;
		volume?: number;
		charge?: number;
	};
	conflictType: 'duplicate' | 'modified' | 'deleted';
	resolution?: 'keep_local' | 'keep_server' | 'merge';
}

export interface SyncResult {
	success: boolean;
	synced: number;
	failed: number;
	conflicts: SyncConflict[];
	errors: string[];
}

// Sync configuration
export const syncConfig = writable({
	maxRetries: 3,
	retryDelay: 1000, // ms
	batchSize: 10,
	conflictResolution: 'ask_user' as 'ask_user' | 'keep_local' | 'keep_server'
});

// Sync queue and status
export const syncQueue = writable<OfflineExpense[]>([]);
export const syncConflicts = writable<SyncConflict[]>([]);
export const lastSyncTime = writable<Date | null>(null);

// Fetch last sync time from server
export async function fetchLastSyncTime(): Promise<void> {
	try {
		const response = await fetch('/api/sync/status', {
			credentials: 'include'
		});

		if (response.ok) {
			const result = await response.json();
			if (result.success && result.status) {
				// Use lastSyncDate (Google Sheets sync) or lastBackupDate (Google Drive backup)
				// Prefer the most recent one
				const syncDate = result.status.lastSyncDate ? new Date(result.status.lastSyncDate) : null;
				const backupDate = result.status.lastBackupDate
					? new Date(result.status.lastBackupDate)
					: null;

				let mostRecentSync: Date | null = null;
				if (syncDate && backupDate) {
					mostRecentSync = syncDate > backupDate ? syncDate : backupDate;
				} else if (syncDate) {
					mostRecentSync = syncDate;
				} else if (backupDate) {
					mostRecentSync = backupDate;
				}

				if (mostRecentSync) {
					lastSyncTime.set(mostRecentSync);
				}
			}
		}
	} catch (error) {
		console.error('Failed to fetch last sync time:', error);
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

		if (!get(isOnline)) {
			throw new Error('Cannot sync while offline');
		}

		this.syncInProgress = true;
		syncStatus.set('syncing');

		try {
			const pendingExpenses = this.getPendingExpenses();
			const result = await this.syncExpenses(pendingExpenses);

			if (result.success && result.conflicts.length === 0) {
				lastSyncTime.set(new Date());
				syncStatus.set('success');
			} else if (result.conflicts.length > 0) {
				syncConflicts.set(result.conflicts);
				syncStatus.set('error');
			} else {
				syncStatus.set('error');
			}

			// Reset status after delay
			setTimeout(() => {
				if (get(syncStatus) !== 'syncing') {
					syncStatus.set('idle');
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

		const config = get(syncConfig);

		// Process in batches
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

						// Handle retry logic
						const retries = this.retryCount.get(expense.id) || 0;
						if (retries < config.maxRetries) {
							this.retryCount.set(expense.id, retries + 1);
							// Schedule retry
							setTimeout(
								() => {
									this.retrySingleExpense(expense);
								},
								config.retryDelay * Math.pow(2, retries)
							); // Exponential backoff
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
			// Check for existing expense (conflict detection)
			const existingExpense = await this.checkForExistingExpense(expense);

			if (existingExpense) {
				// Conflict detected
				const conflict: SyncConflict = {
					id: expense.id,
					localExpense: expense,
					serverExpense: existingExpense,
					conflictType: this.determineConflictType(expense, existingExpense)
				};

				return { success: false, conflict };
			}

			// Validate fuel expense requirements
			if ((expense.category === 'fuel' && !expense.volume && !expense.charge) || !expense.mileage) {
				return {
					success: false,
					error:
						'Fuel expenses require volume/charge and mileage data. Please edit the expense and add the missing information.'
				};
			}

			// No conflict, proceed with sync
			const response = await fetch(`/api/expenses`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({
					vehicleId: expense.vehicleId,
					tags: expense.tags,
					category: expense.category,
					amount: expense.amount,
					currency: expense.currency || 'USD',
					date: expense.date,
					mileage: expense.mileage,
					volume: expense.volume,
					charge: expense.charge,
					description: expense.description
				})
			});

			if (!response.ok) {
				const errorText = await response.text();
				return { success: false, error: `HTTP ${response.status}: ${errorText}` };
			}

			return { success: true };
		} catch (error) {
			return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
		}
	}

	private async checkForExistingExpense(
		expense: OfflineExpense
	): Promise<{ date: string; amount: number; tags: string[] } | null> {
		try {
			const response = await fetch(
				`/api/expenses?vehicleId=${expense.vehicleId}&date=${expense.date}&amount=${expense.amount}`
			);

			if (!response.ok) return null;

			const result = await response.json();
			const expenses = Array.isArray(result.data)
				? result.data
				: Array.isArray(result)
					? result
					: [];

			// Look for potential duplicates with overlapping tags
			return (
				expenses.find((existing: { date: string; amount: number; tags: string[] }) =>
					expense.tags.some(tag => existing.tags?.includes(tag))
				) || null
			);
		} catch (error) {
			console.warn('Failed to check for existing expense:', error);
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
		if (!get(isOnline)) {
			return;
		}

		try {
			const result = await this.syncSingleExpense(expense);

			if (result.success) {
				this.markExpenseAsSynced(expense.id);
				this.retryCount.delete(expense.id);

				// Update UI
				const currentExpenses = get(offlineExpenses);
				const updatedExpenses = currentExpenses.map(e =>
					e.id === expense.id ? { ...e, synced: true } : e
				);
				offlineExpenses.set(updatedExpenses);
			}
		} catch (error) {
			console.error('Retry failed for expense:', expense.id, error);
		}
	}

	async resolveConflict(
		conflict: SyncConflict,
		resolution: 'keep_local' | 'keep_server' | 'merge'
	): Promise<boolean> {
		try {
			switch (resolution) {
				case 'keep_local': {
					// Force sync the local version
					const response = await fetch(`/api/expenses`, {
						method: 'POST',
						headers: {
							'Content-Type': 'application/json'
						},
						body: JSON.stringify({
							vehicleId: conflict.localExpense.vehicleId,
							tags: conflict.localExpense.tags,
							category: conflict.localExpense.category,
							amount: conflict.localExpense.amount,
							date: conflict.localExpense.date,
							mileage: conflict.localExpense.mileage,
							volume: conflict.localExpense.volume,
							charge: conflict.localExpense.charge,
							description: conflict.localExpense.description,
							forceOverwrite: true
						})
					});

					if (response.ok) {
						this.markExpenseAsSynced(conflict.localExpense.id);
						return true;
					}
					break;
				}

				case 'keep_server':
					// Mark local as synced without uploading
					this.markExpenseAsSynced(conflict.localExpense.id);
					return true;

				case 'merge':
					// For now, merge means keep local with server's ID
					// In a real implementation, this would be more sophisticated
					return await this.resolveConflict(conflict, 'keep_local');
			}
		} catch (error) {
			console.error('Failed to resolve conflict:', error);
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

	// Auto-sync when coming online
	setupAutoSync(): void {
		if (this.autoSyncSetup) {
			return;
		}

		this.autoSyncSetup = true;

		// Fetch initial last sync time
		fetchLastSyncTime();

		isOnline.subscribe(async online => {
			if (online && !this.syncInProgress) {
				// Refresh last sync time when coming online
				fetchLastSyncTime();

				const pendingExpenses = this.getPendingExpenses();
				if (pendingExpenses.length > 0) {
					// Wait a bit for network to stabilize
					setTimeout(() => {
						this.syncAll().catch(console.error);
					}, 2000);
				}
			}
		});
	}
}

export const syncManager = new SyncManager();
