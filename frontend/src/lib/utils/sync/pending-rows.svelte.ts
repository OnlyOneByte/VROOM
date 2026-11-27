import { untrack } from 'svelte';
import { offlineExpenseQueue } from '#lib/stores/offline.svelte.ts';
import type { Expense } from '#lib/types/index.ts';
import {
	withoutListed,
	keepLeftRows,
	pendingExpenseRow,
	pendingRowState,
	rowsLeft,
	rowStates,
	type PendingItem,
	type PendingRowState
} from './pending-rows.ts';

function inSummary(syncedAt: number | undefined, summarySince: number | undefined): boolean {
	return syncedAt !== undefined && summarySince !== undefined && summarySince >= syncedAt;
}

export function usePendingRows(options: {
	match: (expense: Expense) => boolean;
	refresh: () => Promise<unknown>;
	listedIds?: () => ReadonlySet<string>;
	summaryRequestedAt?: () => number | undefined;
}) {
	const live = $derived<PendingItem[]>(
		offlineExpenseQueue.current
			.filter(entry => !entry.synced)
			.sort((a, b) => b.timestamp - a.timestamp)
			.map(entry => ({ row: pendingExpenseRow(entry), state: pendingRowState(entry) }))
			.filter(({ row }) => options.match(row))
	);
	const syncedServerIds = $derived(
		offlineExpenseQueue.current.flatMap(entry =>
			entry.synced ? [[entry.id, entry.serverId] as const] : []
		)
	);
	let shown = $state<PendingItem[]>([]);
	const visible = $derived(options.listedIds ? withoutListed(shown, options.listedIds()) : shown);
	let previousIds: string[] = [];
	let refreshing = 0;

	$effect(() => {
		const current = live;
		const left = rowsLeft(previousIds, current);
		previousIds = current.map(({ row }) => row.id);
		if (!left && refreshing === 0) {
			shown = current;
			return;
		}
		untrack(() => {
			shown = keepLeftRows(shown, current, syncedServerIds);
			if (!left) return;
			refreshing++;
			void options.refresh().finally(() => {
				refreshing--;
				if (refreshing === 0) shown = live;
			});
		});
	});

	return {
		get rows(): Expense[] {
			return visible.map(({ row }) => row);
		},
		get states(): ReadonlyMap<string, PendingRowState> {
			return rowStates(visible);
		},
		get saving(): Expense[] {
			const summarySince = options.summaryRequestedAt?.();
			return visible
				.filter(({ state }) => state.status === 'saving')
				.filter(({ syncedAt }) => !inSummary(syncedAt, summarySince))
				.map(({ row }) => row);
		}
	};
}
