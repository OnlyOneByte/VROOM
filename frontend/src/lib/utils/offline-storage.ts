import { offlineExpenses, syncStatus } from '$lib/stores/offline';

const OFFLINE_STORAGE_KEY = 'vroom_offline_expenses';

export interface OfflineExpense {
	id: string;
	vehicleId: string;
	type: string;
	category: string;
	amount: number;
	currency?: string;
	date: string;
	mileage?: number;
	gallons?: number;
	description?: string;
	timestamp: number;
	synced: boolean;
}

// Load offline expenses from localStorage
export function loadOfflineExpenses(): OfflineExpense[] {
	if (typeof window === 'undefined') return [];

	try {
		const stored = localStorage.getItem(OFFLINE_STORAGE_KEY);
		return stored ? JSON.parse(stored) : [];
	} catch (error) {
		console.error('Failed to load offline expenses:', error);
		return [];
	}
}

// Save offline expenses to localStorage
export function saveOfflineExpenses(expenses: OfflineExpense[]): void {
	if (typeof window === 'undefined') return;

	try {
		localStorage.setItem(OFFLINE_STORAGE_KEY, JSON.stringify(expenses));
		offlineExpenses.set(expenses);
	} catch (error) {
		console.error('Failed to save offline expenses:', error);
	}
}

// Add expense to offline queue
export function addOfflineExpense(
	expense: Omit<OfflineExpense, 'id' | 'timestamp' | 'synced'>
): void {
	const offlineExpense: OfflineExpense = {
		...expense,
		id: `offline_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
		timestamp: Date.now(),
		synced: false
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

	if (pendingExpenses.length === 0) {
		return;
	}

	syncStatus.set('syncing');

	try {
		for (const expense of pendingExpenses) {
			// Convert offline expense to API format
			const apiExpense = {
				type: expense.type,
				category: expense.category,
				amount: expense.amount,
				currency: expense.currency || 'USD',
				date: expense.date,
				mileage: expense.mileage,
				gallons: expense.gallons,
				description: expense.description
			};

			// Send to API
			const response = await fetch(`/api/vehicles/${expense.vehicleId}/expenses`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json'
				},
				body: JSON.stringify(apiExpense)
			});

			if (response.ok) {
				markExpenseAsSynced(expense.id);
			} else {
				throw new Error(`Failed to sync expense ${expense.id}`);
			}
		}

		// Clean up synced expenses
		clearSyncedExpenses();
		syncStatus.set('success');

		// Reset status after 3 seconds
		setTimeout(() => syncStatus.set('idle'), 3000);
	} catch (error) {
		console.error('Failed to sync offline expenses:', error);
		syncStatus.set('error');

		// Reset status after 5 seconds
		setTimeout(() => syncStatus.set('idle'), 5000);
	}
}
