import { onlineStatus, syncState, offlineExpenseQueue } from '#lib/stores/offline.svelte.ts';
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
	clearNeedsAttention,
	clearSyncedExpenses,
	getNeedsAttentionExpenses,
	getPendingExpenses,
	INCOMPLETE_FUEL_REASON,
	isIncompleteFuelExpense,
	loadPendingPhotos,
	markExpenseAsSynced,
	markExpenseNeedsAttention,
	offlineExpenseToBackend,
	savePendingPhotos,
	type OfflineExpense
} from '../offline-storage';
import { extractErrorMessage } from '#lib/utils/error-handling.ts';
import { classifySyncFailure, type SyncFailureKind } from './classify-failure';
import { apiClient } from '#lib/services/api-client.ts';
import { expenseApi } from '#lib/services/expense-api.ts';
import { fromBackendExpense } from '#lib/services/api-transformer.ts';
import type { BackendExpenseResponse } from '#lib/types/index.ts';
import { browser } from '$app/env';

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

const AMOUNT_EPSILON = 0.005;
const AUTO_SYNC_DELAY_MS = 2000;
const AUTO_SYNC_RETRY_BASE_MS = 30_000;
const AUTO_SYNC_RETRY_MAX_MS = 15 * 60_000;

function toEpochSeconds(date: string): number {
	return Math.floor(new Date(date).getTime() / 1000);
}

function serverCopyDiffers(local: OfflineExpense, server: BackendExpenseResponse): boolean {
	const sent = offlineExpenseToBackend(local);
	const sameTags =
		JSON.stringify([...sent.tags].sort()) === JSON.stringify([...(server.tags ?? [])].sort());
	const fuelMatches =
		sent.category !== 'fuel' ||
		((sent.mileage ?? null) === (server.mileage ?? null) &&
			(sent.volume ?? null) === (server.volume ?? null) &&
			(sent.fuelType ?? null) === (server.fuelType ?? null));
	return !(
		Math.abs(sent.expenseAmount - server.expenseAmount) < AMOUNT_EPSILON &&
		toEpochSeconds(sent.date) === toEpochSeconds(server.date) &&
		sent.vehicleId === server.vehicleId &&
		sent.category === server.category &&
		sameTags &&
		(sent.description || '') === (server.description || '') &&
		(sent.location || '') === (server.location || '') &&
		(sent.sourceId ?? null) === (server.sourceId ?? null) &&
		fuelMatches
	);
}

type SingleSyncResult = {
	success: boolean;
	conflict?: SyncConflict;
	error?: string;
	failureKind?: SyncFailureKind;
	serverId?: string;
};

function conflictWith(local: OfflineExpense, server: BackendExpenseResponse): SyncConflict {
	return { id: local.id, localExpense: local, serverExpense: fromBackendExpense(server) };
}

function wasEditedOnServer(row: BackendExpenseResponse): boolean {
	return !!row.createdAt && !!row.updatedAt && row.createdAt !== row.updatedAt;
}

async function uploadPhotosInOrder(clientId: string, serverId: string): Promise<void> {
	const photos = await loadPendingPhotos(clientId);
	for (const [index, photo] of photos.entries()) {
		await expenseApi.uploadPhoto('expense', serverId, photo);
		await savePendingPhotos(clientId, photos.slice(index + 1));
	}
}

function retryableExpenses(): OfflineExpense[] {
	const conflicted = new Set(syncConflicts.current.map(conflict => conflict.localExpense.id));
	return getPendingExpenses().filter(expense => !conflicted.has(expense.id));
}

class SyncManager {
	private retryCount = new Map<string, number>();
	private photoUploads = new Map<string, Promise<void>>();
	private syncInProgress = false;
	private autoSyncSetup = false;
	private autoSyncTimer: ReturnType<typeof setTimeout> | null = null;
	private autoSyncAttempt = 0;

	async syncAll(options: { skipConflicted?: boolean } = {}): Promise<SyncResult> {
		if (this.syncInProgress) {
			throw new Error('Sync already in progress');
		}

		if (!onlineStatus.current) {
			throw new Error('Cannot sync while offline');
		}

		this.syncInProgress = true;
		syncState.current = 'syncing';

		try {
			const pendingExpenses = options.skipConflicted ? retryableExpenses() : getPendingExpenses();
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
			this.continueAutoSync();
		}
	}

	async retryParked(): Promise<SyncResult> {
		if (this.syncInProgress) {
			throw new Error('Sync already in progress');
		}

		if (!onlineStatus.current) {
			throw new Error('Cannot sync while offline');
		}

		for (const expense of getNeedsAttentionExpenses()) {
			clearNeedsAttention(expense.id);
		}

		return this.syncAll();
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
						markExpenseNeedsAttention(expense.id, reason, syncResult.serverId);
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

	private async syncSingleExpense(expense: OfflineExpense): Promise<SingleSyncResult> {
		try {
			let serverId = expense.serverId;
			if (!serverId) {
				const serverCopy = await this.findServerCopy(expense);

				if (serverCopy && serverCopyDiffers(expense, serverCopy)) {
					return { success: false, conflict: conflictWith(expense, serverCopy) };
				}

				if (!serverCopy && isIncompleteFuelExpense(expense)) {
					return { success: false, failureKind: 'terminal', error: INCOMPLETE_FUEL_REASON };
				}

				if (serverCopy) {
					serverId = serverCopy.id;
				} else {
					const saved = await this.postExpense(expense, false);
					if (wasEditedOnServer(saved) && serverCopyDiffers(expense, saved)) {
						return { success: false, conflict: conflictWith(expense, saved) };
					}
					serverId = saved.id;
				}
			}

			return await this.deliverQueuedPhotos(expense, serverId);
		} catch (error) {
			return {
				success: false,
				failureKind: classifySyncFailure(error),
				error: extractErrorMessage(error, 'Unknown error')
			};
		}
	}

	private async deliverQueuedPhotos(
		expense: OfflineExpense,
		serverId: string
	): Promise<SingleSyncResult> {
		try {
			await this.uploadQueuedPhotos(expense, serverId);
			return { success: true };
		} catch (error) {
			if (classifySyncFailure(error) !== 'terminal') throw error;
			return {
				success: false,
				failureKind: 'terminal',
				error: `A photo couldn't be uploaded: ${extractErrorMessage(error, 'Unknown error')}`,
				serverId
			};
		}
	}

	private async findServerCopy(expense: OfflineExpense): Promise<BackendExpenseResponse | null> {
		try {
			const filters = new URLSearchParams({
				vehicleId: expense.vehicleId,
				startDate: expense.date.slice(0, 10),
				endDate: expense.date.slice(0, 10)
			});
			const rows = await apiClient.get<BackendExpenseResponse[]>(
				`/api/v1/expenses?${filters.toString()}`
			);
			const isSameRecord = (row: BackendExpenseResponse) =>
				!!expense.clientId && row.clientId === expense.clientId;
			return (Array.isArray(rows) && rows.find(isSameRecord)) || null;
		} catch (error) {
			if (import.meta.env.DEV) console.warn('Failed to check for existing expense:', error);
			return null;
		}
	}

	private postExpense(expense: OfflineExpense, forceOverwrite: boolean) {
		return apiClient.post<BackendExpenseResponse>('/api/v1/expenses', {
			...offlineExpenseToBackend(expense, { clearEmptyFields: forceOverwrite }),
			clientId: expense.clientId,
			...(forceOverwrite && { forceOverwrite })
		});
	}

	private uploadQueuedPhotos(expense: OfflineExpense, serverId: string): Promise<void> {
		const clientId = expense.clientId;
		if (!clientId) return Promise.resolve();
		const inFlight = this.photoUploads.get(clientId);
		if (inFlight) return inFlight;
		const upload = uploadPhotosInOrder(clientId, serverId).finally(() =>
			this.photoUploads.delete(clientId)
		);
		this.photoUploads.set(clientId, upload);
		return upload;
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
				markExpenseNeedsAttention(
					expense.id,
					result.error || 'Entry needs attention',
					result.serverId
				);
				this.retryCount.delete(expense.id);
			}
		} catch (error) {
			if (import.meta.env.DEV) console.error('Retry failed for expense:', expense.id, error);
		}
	}

	async resolveConflict(
		conflict: SyncConflict,
		resolution: 'keep_local' | 'keep_server'
	): Promise<boolean> {
		const local = conflict.localExpense;
		try {
			const serverId =
				resolution === 'keep_local'
					? (await this.postExpense(local, true)).id
					: conflict.serverExpense.id;
			await this.uploadQueuedPhotos(local, serverId);
			markExpenseAsSynced(local.id);
			return true;
		} catch (error) {
			if (import.meta.env.DEV) console.error('Failed to resolve conflict:', error);
			return false;
		}
	}

	setupAutoSync(): void {
		if (this.autoSyncSetup) return;
		this.autoSyncSetup = true;

		fetchLastSyncTime();

		if (!browser) return;

		if (onlineStatus.current && getPendingExpenses().length > 0) this.restartAutoSync();

		window.addEventListener('online', () => {
			fetchLastSyncTime();
			this.restartAutoSync();
		});

		document.addEventListener('visibilitychange', () => {
			if (document.visibilityState === 'visible') this.restartAutoSync();
		});
	}

	private restartAutoSync(): void {
		this.autoSyncAttempt = 0;
		this.scheduleAutoSync(AUTO_SYNC_DELAY_MS);
	}

	private scheduleAutoSync(delay: number): void {
		if (this.autoSyncTimer) clearTimeout(this.autoSyncTimer);
		this.autoSyncTimer = setTimeout(() => {
			this.autoSyncTimer = null;
			void this.runAutoSync();
		}, delay);
	}

	requestAutoSync(): void {
		this.continueAutoSync();
	}

	private continueAutoSync(): void {
		if (!this.autoSyncSetup) return;
		if (!onlineStatus.current || retryableExpenses().length === 0) {
			this.autoSyncAttempt = 0;
			return;
		}
		if (this.autoSyncTimer) return;
		const delay = Math.min(
			AUTO_SYNC_RETRY_BASE_MS * 2 ** this.autoSyncAttempt,
			AUTO_SYNC_RETRY_MAX_MS
		);
		this.autoSyncAttempt++;
		this.scheduleAutoSync(delay);
	}

	private async runAutoSync(): Promise<void> {
		if (!onlineStatus.current || retryableExpenses().length === 0) return;
		if (this.syncInProgress) {
			this.scheduleAutoSync(AUTO_SYNC_DELAY_MS);
			return;
		}

		try {
			await this.syncAll({ skipConflicted: true });
		} catch (error) {
			if (import.meta.env.DEV) console.error('Auto-sync failed:', error);
		}
	}
}

export const syncManager = new SyncManager();
