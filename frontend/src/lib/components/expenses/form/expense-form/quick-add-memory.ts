import { browser } from '$app/env';
import { EXPENSE_CATEGORIES } from '#lib/constants/expense-categories.ts';
import { currentOfflineQueueOwner } from '#lib/utils/offline-storage.ts';

const STORAGE_KEY = 'vroom.expense.quick-add';

export interface QuickAddMemory {
	vehicleId: string | null;
	categoryByVehicle: Record<string, string>;
}

const EMPTY: QuickAddMemory = { vehicleId: null, categoryByVehicle: {} };

function storageKey(): string {
	const owner = currentOfflineQueueOwner();
	return owner ? `${STORAGE_KEY}:${owner}` : STORAGE_KEY;
}

function isCategory(value: unknown): value is string {
	return typeof value === 'string' && (EXPENSE_CATEGORIES as readonly string[]).includes(value);
}

export function readQuickAddMemory(): QuickAddMemory {
	if (!browser) return EMPTY;
	try {
		const stored = JSON.parse(localStorage.getItem(storageKey()) ?? 'null');
		if (!stored || typeof stored !== 'object') return EMPTY;
		const categories = stored.categoryByVehicle ?? {};
		return {
			vehicleId: typeof stored.vehicleId === 'string' ? stored.vehicleId : null,
			categoryByVehicle: Object.fromEntries(
				Object.entries(categories).filter((entry): entry is [string, string] =>
					isCategory(entry[1])
				)
			)
		};
	} catch {
		return EMPTY;
	}
}

export function rememberQuickAdd(vehicleId: string, category: string): void {
	if (!browser || !vehicleId || !isCategory(category)) return;
	const memory = readQuickAddMemory();
	try {
		localStorage.setItem(
			storageKey(),
			JSON.stringify({
				vehicleId,
				categoryByVehicle: { ...memory.categoryByVehicle, [vehicleId]: category }
			})
		);
	} catch (error) {
		if (import.meta.env.DEV) console.error('Failed to remember the last expense:', error);
	}
}
