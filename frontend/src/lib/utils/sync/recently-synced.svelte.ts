import { SvelteMap } from 'svelte/reactivity';
import type { Expense } from '#lib/types/index.ts';
import type { OfflineExpense } from '#lib/utils/offline-storage.ts';
import { pendingExpenseRow } from './pending-rows.ts';

const LIMIT = 20;
export const RECENTLY_SYNCED_MAX_AGE_MS = 30_000;
const rows = new SvelteMap<string, { row: Expense; at: number }>();

export function rememberSynced(entry: OfflineExpense, now = Date.now()): void {
	rows.delete(entry.id);
	rows.set(entry.id, { row: pendingExpenseRow(entry), at: now });
	for (const id of rows.keys()) {
		if (rows.size <= LIMIT) break;
		rows.delete(id);
	}
}

export function recentlySynced(now = Date.now()): Expense[] {
	return [...rows.values()]
		.filter(({ at }) => now - at <= RECENTLY_SYNCED_MAX_AGE_MS)
		.map(({ row }) => row)
		.reverse();
}

export function forgetRecentlySynced(): void {
	rows.clear();
}
