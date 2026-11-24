import { untrack } from 'svelte';
import { offlineExpenseQueue } from '#lib/stores/offline.svelte.ts';
import type { Expense } from '#lib/types/index.ts';
import {
	keepLeftRows,
	pendingExpenseRow,
	pendingRowState,
	rowsLeft,
	rowStates,
	type PendingItem,
	type PendingRowState
} from './pending-rows.ts';

export function usePendingRows(options: {
	match: (expense: Expense) => boolean;
	refresh: () => Promise<unknown>;
}) {
	const live = $derived<PendingItem[]>(
		offlineExpenseQueue.current
			.filter(entry => !entry.synced)
			.sort((a, b) => b.timestamp - a.timestamp)
			.map(entry => ({ row: pendingExpenseRow(entry), state: pendingRowState(entry) }))
			.filter(({ row }) => options.match(row))
	);
	let shown = $state<PendingItem[]>([]);
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
			shown = keepLeftRows(shown, current);
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
			return shown.map(({ row }) => row);
		},
		get states(): ReadonlyMap<string, PendingRowState> {
			return rowStates(shown);
		},
		get saving(): Expense[] {
			return shown.filter(({ state }) => state.status === 'saving').map(({ row }) => row);
		}
	};
}
