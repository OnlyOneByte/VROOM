import { offlineExpenseQueue } from '$lib/stores/offline.svelte';
import { toBackendExpense } from '$lib/services/api-transformer';
import { browser } from '$app/environment';
import type { ExpenseCategory } from '$lib/types';

const OFFLINE_STORAGE_KEY = 'vroom_offline_expenses';
const CORRUPT_STORAGE_KEY = 'vroom_offline_expenses.corrupt';
const OFFLINE_STORAGE_VERSION = '3.0';

export interface OfflineExpense {
	id: string;
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
	location?: string;
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
		description: expense.description,
		location: expense.location
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
		// Best-effort: a failed stash must not block startup.
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
