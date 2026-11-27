import { SvelteMap } from 'svelte/reactivity';
import type { Expense } from '#lib/types/index.ts';
import type { OfflineExpense } from '#lib/utils/offline-storage.ts';
import { pendingExpenseRow } from './pending-rows.ts';

const LIMIT = 20;
export const RECENTLY_SYNCED_MAX_AGE_MS = 30_000;

interface SyncedRow {
	row: Expense;
	at: number;
	clientId?: string | undefined;
	serverId?: string | undefined;
}

const rows = new SvelteMap<string, SyncedRow>();

export function rememberSynced(entry: OfflineExpense, now = Date.now()): void {
	rows.delete(entry.id);
	rows.set(entry.id, {
		row: pendingExpenseRow(entry),
		at: now,
		clientId: entry.clientId,
		serverId: entry.serverId
	});
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

export function syncedExpenseByClientId(clientId: string): Expense | undefined {
	for (const { row, clientId: id, serverId } of rows.values()) {
		if (id === clientId && serverId) return { ...row, id: serverId };
	}
	return undefined;
}

export function forgetSyncedByClientId(clientId: string): void {
	for (const [key, synced] of rows) {
		if (synced.clientId === clientId) rows.delete(key);
	}
}

export function forgetRecentlySynced(): void {
	rows.clear();
}
