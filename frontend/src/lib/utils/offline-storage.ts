import { offlineExpenseQueue, syncState } from '$lib/stores/offline.svelte';
import { toBackendExpense } from '$lib/services/api-transformer';
import { apiClient } from '$lib/services/api-client';
import { browser } from '$app/environment';
import type { ExpenseCategory } from '$lib/types';

const OFFLINE_STORAGE_KEY = 'vroom_offline_expenses';
const OFFLINE_STORAGE_VERSION = '3.0'; // v3: added clientId idempotency key

export interface OfflineExpense {
	id: string;
	/**
	 * Stable idempotency key sent to the backend on create. A retried POST with the
	 * same clientId returns the original server row instead of duplicating it, so
	 * sync is safe to retry without the fragile fuzzy duplicate-detection fallback.
	 * Optional only for legacy (pre-v3) persisted entries; `addOfflineExpense` always
	 * sets it and `loadOfflineExpenses` backfills it on read, so live entries always
	 * carry one before they are ever synced.
	 */
	clientId?: string;
	vehicleId: string;
	type?: string; // Deprecated, kept for backwards compatibility
	tags: string[]; // New flexible tags
	category: string; // Stored as string from user input; validated at sync time
	amount: number;
	currency?: string;
	date: string;
	mileage?: number;
	volume?: number; // For fuel expenses
	charge?: number; // For electric charging
	description?: string;
	timestamp: number;
	synced: boolean;
	version?: string; // Storage format version
}

// Load offline expenses from localStorage
export function loadOfflineExpenses(): OfflineExpense[] {
	if (!browser) return [];

	try {
		const stored = localStorage.getItem(OFFLINE_STORAGE_KEY);
		if (!stored) return [];

		const expenses: OfflineExpense[] = JSON.parse(stored);

		// Migrate old format expenses to new format if needed
		return expenses.map(expense => {
			if (!expense.version || expense.version !== OFFLINE_STORAGE_VERSION) {
				// Backfill a clientId for pre-v3 entries so they sync idempotently.
				// MUST be DETERMINISTIC across reads: this migration runs on every read of a
				// not-yet-persisted legacy entry, so a `crypto.randomUUID()` fallback minted a
				// DIFFERENT key each time — defeating the very idempotency it backfills (a retried
				// POST after a lost response would carry a fresh clientId, the server couldn't dedup,
				// and the offline entry would duplicate). The entry's own `id` is already stable and
				// unique per entry, so it is the correct deterministic idempotency key.
				return {
					...expense,
					clientId: expense.clientId ?? expense.id,
					version: OFFLINE_STORAGE_VERSION
				};
			}
			return expense;
		});
	} catch (error) {
		if (import.meta.env.DEV) console.error('Failed to load offline expenses:', error);
		return [];
	}
}

// Save offline expenses to localStorage
export function saveOfflineExpenses(expenses: OfflineExpense[]): void {
	if (!browser) return;

	try {
		localStorage.setItem(OFFLINE_STORAGE_KEY, JSON.stringify(expenses));
		offlineExpenseQueue.current = expenses;
	} catch (error) {
		if (import.meta.env.DEV) console.error('Failed to save offline expenses:', error);
	}
}

// Add expense to offline queue
export function addOfflineExpense(
	expense: Omit<OfflineExpense, 'id' | 'clientId' | 'timestamp' | 'synced' | 'version'>
): void {
	const offlineExpense: OfflineExpense = {
		...expense,
		id: `offline_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
		clientId: crypto.randomUUID(),
		timestamp: Date.now(),
		synced: false,
		version: OFFLINE_STORAGE_VERSION
	};

	const currentExpenses = loadOfflineExpenses();
	const updatedExpenses = [...currentExpenses, offlineExpense];
	saveOfflineExpenses(updatedExpenses);
}

// Remove synced expense from offline queue
export function removeOfflineExpense(id: string): void {
	const currentExpenses = loadOfflineExpenses();
	const updatedExpenses = currentExpenses.filter(expense => expense.id !== id);
	saveOfflineExpenses(updatedExpenses);
}

// Get pending (unsynced) expenses
export function getPendingExpenses(): OfflineExpense[] {
	return loadOfflineExpenses().filter(expense => !expense.synced);
}

// Mark expense as synced
export function markExpenseAsSynced(id: string): void {
	const currentExpenses = loadOfflineExpenses();
	const updatedExpenses = currentExpenses.map(expense =>
		expense.id === id ? { ...expense, synced: true } : expense
	);
	saveOfflineExpenses(updatedExpenses);
}

// Clear all synced expenses
export function clearSyncedExpenses(): void {
	const currentExpenses = loadOfflineExpenses();
	const pendingExpenses = currentExpenses.filter(expense => !expense.synced);
	saveOfflineExpenses(pendingExpenses);
}

// Sync offline expenses with server
export async function syncOfflineExpenses(): Promise<void> {
	const pendingExpenses = getPendingExpenses();

	if (pendingExpenses.length === 0) return;

	syncState.current = 'syncing';

	try {
		for (const expense of pendingExpenses) {
			// Validate fuel expense requirements
			if (
				expense.category === 'fuel' &&
				((!expense.volume && !expense.charge) || !expense.mileage)
			) {
				if (import.meta.env.DEV) {
					console.warn(
						`Skipping expense ${expense.id}: Fuel expenses require volume/charge and mileage data`
					);
				}
				continue;
			}

			// Transform to backend format using API transformer
			const backendExpense = toBackendExpense({
				vehicleId: expense.vehicleId,
				tags: expense.tags || [],
				category: expense.category as ExpenseCategory,
				amount: expense.amount,
				date: expense.date,
				mileage: expense.mileage,
				volume: expense.volume,
				charge: expense.charge,
				description: expense.description
			});

			// Send the idempotency key so a retried POST returns the original row.
			await apiClient.post('/api/v1/expenses', { ...backendExpense, clientId: expense.clientId });
			markExpenseAsSynced(expense.id);
		}

		clearSyncedExpenses();
		syncState.current = 'success';
		setTimeout(() => (syncState.current = 'idle'), 3000);
	} catch (error) {
		if (import.meta.env.DEV) console.error('Failed to sync offline expenses:', error);
		syncState.current = 'error';
		setTimeout(() => (syncState.current = 'idle'), 5000);
	}
}
