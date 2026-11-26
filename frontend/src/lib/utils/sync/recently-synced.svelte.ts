import { SvelteMap } from 'svelte/reactivity';
import type { Expense } from '#lib/types/index.ts';
import type { OfflineExpense } from '#lib/utils/offline-storage.ts';
import { pendingExpenseRow } from './pending-rows.ts';

const LIMIT = 20;
const rows = new SvelteMap<string, Expense>();

export function rememberSynced(entry: OfflineExpense): void {
	rows.delete(entry.id);
	rows.set(entry.id, pendingExpenseRow(entry));
	for (const id of rows.keys()) {
		if (rows.size <= LIMIT) break;
		rows.delete(id);
	}
}

export function recentlySynced(): Expense[] {
	return [...rows.values()].reverse();
}

export function forgetRecentlySynced(): void {
	rows.clear();
}
