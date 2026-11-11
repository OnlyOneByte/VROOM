import { offlineExpenseQueue, syncState } from '$lib/stores/offline.svelte';
import { toBackendExpense } from '$lib/services/api-transformer';
import { apiClient } from '$lib/services/api-client';
import { classifySyncFailure } from '$lib/utils/sync/classify-failure';
import { extractErrorMessage } from '$lib/utils/error-handling';
import { browser } from '$app/environment';
import type { ExpenseCategory } from '$lib/types';

const OFFLINE_STORAGE_KEY = 'vroom_offline_expenses';
const CORRUPT_STORAGE_KEY = 'vroom_offline_expenses.corrupt';
const OFFLINE_STORAGE_VERSION = '3.0';

export interface OfflineExpense {
	id: string;
	// Idempotency key: a retried POST returns the original row. Backfilled deterministically on read.
	clientId?: string;
	vehicleId: string;
	type?: string;
	tags: string[];
	category: string;
	amount: number;
	currency?: string;
	date: string;
	mileage?: number;
	volume?: number;
	charge?: number;
	// Must be kept: the sync transform routes charge vs volume solely on this.
	fuelType?: string;
	// Must be kept: a missed fill-up is excluded from MPG pairing.
	missedFillup?: boolean;
	description?: string;
	timestamp: number;
	synced: boolean;
	needsAttention?: boolean;
	attentionReason?: string;
	version?: string;
}

export function offlineExpenseToBackend(
	expense: OfflineExpense
): ReturnType<typeof toBackendExpense> {
	return toBackendExpense({
		vehicleId: expense.vehicleId,
		tags: expense.tags,
		category: expense.category as ExpenseCategory,
		amount: expense.amount,
		date: expense.date,
		mileage: expense.mileage,
		volume: expense.volume,
		charge: expense.charge,
		fuelType: expense.fuelType,
		missedFillup: expense.missedFillup,
		description: expense.description
	});
}

export function isIncompleteFuelExpense(expense: OfflineExpense): boolean {
	return expense.category === 'fuel' && ((!expense.volume && !expense.charge) || !expense.mileage);
}

export const INCOMPLETE_FUEL_REASON =
	'Fuel expenses require volume/charge and mileage data. Please edit the expense and add the missing information.';

export function loadOfflineExpenses(): OfflineExpense[] {
	if (!browser) return [];

	try {
		const stored = localStorage.getItem(OFFLINE_STORAGE_KEY);
		if (!stored) return [];

		const expenses: OfflineExpense[] = JSON.parse(stored);

		return expenses.map(expense => {
			if (!expense.version || expense.version !== OFFLINE_STORAGE_VERSION) {
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
		stashCorruptedBlob();
		return [];
	}
}

function stashCorruptedBlob(): void {
	try {
		const raw = localStorage.getItem(OFFLINE_STORAGE_KEY);
		if (raw) localStorage.setItem(CORRUPT_STORAGE_KEY, raw);
	} catch {
		// Best-effort: failing to preserve the corrupt copy must not block startup.
	}
}

export function saveOfflineExpenses(expenses: OfflineExpense[]): boolean {
	if (!browser) return false;

	try {
		localStorage.setItem(OFFLINE_STORAGE_KEY, JSON.stringify(expenses));
	} catch (error) {
		if (import.meta.env.DEV) console.error('Failed to save offline expenses:', error);
		return false;
	}

	offlineExpenseQueue.current = expenses;
	return true;
}

export function addOfflineExpense(
	expense: Omit<OfflineExpense, 'id' | 'clientId' | 'timestamp' | 'synced' | 'version'>
): boolean {
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
	return saveOfflineExpenses(updatedExpenses);
}

export function removeOfflineExpense(id: string): void {
	const currentExpenses = loadOfflineExpenses();
	const updatedExpenses = currentExpenses.filter(expense => expense.id !== id);
	saveOfflineExpenses(updatedExpenses);
}

export function getPendingExpenses(): OfflineExpense[] {
	return loadOfflineExpenses().filter(expense => !expense.synced && !expense.needsAttention);
}

export function getNeedsAttentionExpenses(): OfflineExpense[] {
	return loadOfflineExpenses().filter(expense => !expense.synced && expense.needsAttention);
}

export function markExpenseNeedsAttention(id: string, reason?: string): void {
	const currentExpenses = loadOfflineExpenses();
	const updatedExpenses = currentExpenses.map(expense =>
		expense.id === id
			? {
					...expense,
					needsAttention: true,
					...(reason !== undefined && { attentionReason: reason })
				}
			: expense
	);
	saveOfflineExpenses(updatedExpenses);
}

export function clearNeedsAttention(id: string): void {
	const currentExpenses = loadOfflineExpenses();
	const updatedExpenses = currentExpenses.map(expense =>
		expense.id === id ? { ...expense, needsAttention: false, attentionReason: undefined } : expense
	);
	saveOfflineExpenses(updatedExpenses);
}

export function markExpenseAsSynced(id: string): void {
	const currentExpenses = loadOfflineExpenses();
	const updatedExpenses = currentExpenses.map(expense =>
		expense.id === id ? { ...expense, synced: true } : expense
	);
	saveOfflineExpenses(updatedExpenses);
}

export function clearSyncedExpenses(): void {
	const currentExpenses = loadOfflineExpenses();
	const pendingExpenses = currentExpenses.filter(expense => !expense.synced);
	saveOfflineExpenses(pendingExpenses);
}

export async function syncOfflineExpenses(): Promise<void> {
	const pendingExpenses = getPendingExpenses();

	if (pendingExpenses.length === 0) return;

	syncState.current = 'syncing';

	let failed = 0;

	try {
		for (const expense of pendingExpenses) {
			if (isIncompleteFuelExpense(expense)) {
				if (import.meta.env.DEV) {
					console.warn(
						`Parking expense ${expense.id} (needs attention): fuel expenses require volume/charge and mileage`
					);
				}
				markExpenseNeedsAttention(expense.id, INCOMPLETE_FUEL_REASON);
				continue;
			}

			const backendExpense = offlineExpenseToBackend(expense);

			try {
				await apiClient.post('/api/v1/expenses', {
					...backendExpense,
					clientId: expense.clientId
				});
				markExpenseAsSynced(expense.id);
			} catch (error) {
				const kind = classifySyncFailure(error);
				if (kind === 'terminal') {
					markExpenseNeedsAttention(
						expense.id,
						extractErrorMessage(error, 'The server rejected this entry')
					);
				} else {
					failed++;
				}
				if (import.meta.env.DEV) {
					console.error(`Failed to sync expense ${expense.id} (${kind}):`, error);
				}
			}
		}

		clearSyncedExpenses();
		syncState.current = failed > 0 ? 'error' : 'success';
		setTimeout(() => (syncState.current = 'idle'), failed > 0 ? 5000 : 3000);
	} catch (error) {
		if (import.meta.env.DEV) console.error('Failed to sync offline expenses:', error);
		syncState.current = 'error';
		setTimeout(() => (syncState.current = 'idle'), 5000);
	}
}
