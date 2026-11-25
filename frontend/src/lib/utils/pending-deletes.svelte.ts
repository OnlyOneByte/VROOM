import { SvelteMap } from 'svelte/reactivity';
import { appStore } from '#lib/stores/app.svelte.ts';
import type { Expense } from '#lib/types/index.ts';
import { userFacingErrorMessage } from '#lib/utils/error-handling.ts';
import {
	REFRESH_AFTER_DELETE_FAILED,
	deleteExpenseRecord
} from '#lib/components/expenses/expenses-table/expense-table-actions.ts';
import type { PendingRowState } from '#lib/utils/sync/pending-rows.ts';

export const UNDO_WINDOW_MS = 5000;

type Status = 'waiting' | 'sending' | 'deleted' | 'failed';

interface PendingDelete {
	expense: Expense;
	status: Status;
	error?: string;
	timer?: ReturnType<typeof setTimeout>;
	onDeleted?: (() => Promise<void> | void) | undefined;
}

const keyOf = (expense: Pick<Expense, 'id' | 'groupId'>) => expense.groupId ?? expense.id;
const toastId = (key: string) => `expense-delete-${key}`;

const deletes = new SvelteMap<string, PendingDelete>();

function update(key: string, change: Partial<PendingDelete>): void {
	const entry = deletes.get(key);
	if (entry) deletes.set(key, { ...entry, ...change });
}

async function send(key: string): Promise<void> {
	const entry = deletes.get(key);
	if (!entry) return;
	appStore.dismissToast(toastId(key));
	update(key, { status: 'sending', timer: undefined });
	try {
		await deleteExpenseRecord(entry.expense);
	} catch (error) {
		const reason = userFacingErrorMessage(error);
		update(key, { status: 'failed', error: reason });
		appStore.addNotification({
			type: 'error',
			message: "Couldn't delete the expense",
			description: reason,
			toastId: toastId(key),
			duration: Number.POSITIVE_INFINITY,
			action: { label: 'Retry', onClick: () => retryDelete(key) }
		});
		return;
	}
	update(key, { status: 'deleted' });
	try {
		await entry.onDeleted?.();
	} catch {
		appStore.addNotification({ type: 'warning', message: REFRESH_AFTER_DELETE_FAILED });
	}
}

export function scheduleDelete(expense: Expense, onDeleted?: () => Promise<void> | void): void {
	const key = keyOf(expense);
	const existing = deletes.get(key);
	if (existing && existing.status !== 'failed') return;
	if (existing) appStore.dismissToast(toastId(key));
	deletes.set(key, {
		expense,
		status: 'waiting',
		onDeleted,
		timer: setTimeout(() => void send(key), UNDO_WINDOW_MS)
	});
	appStore.addNotification({
		type: 'success',
		message: 'Expense deleted',
		toastId: toastId(key),
		duration: UNDO_WINDOW_MS,
		action: { label: 'Undo', onClick: () => undoDelete(key) }
	});
}

export function undoDelete(key: string): void {
	const entry = deletes.get(key);
	if (entry?.status !== 'waiting') return;
	clearTimeout(entry.timer);
	deletes.delete(key);
	appStore.dismissToast(toastId(key));
}

export function retryDelete(key: string): void {
	if (deletes.get(key)?.status !== 'failed') return;
	appStore.dismissToast(toastId(key));
	void send(key);
}

export function isDeleteHidden(expense: Pick<Expense, 'id' | 'groupId'>): boolean {
	const status = deletes.get(keyOf(expense))?.status;
	return status !== undefined && status !== 'failed';
}

export function deleteFailureStates(expenses: readonly Expense[]): [string, PendingRowState][] {
	const states: [string, PendingRowState][] = [];
	for (const expense of expenses) {
		const entry = deletes.get(keyOf(expense));
		if (entry?.status === 'failed') {
			states.push([expense.id, { status: 'failed', kind: 'delete', error: entry.error ?? '' }]);
		}
	}
	return states;
}

export function resetPendingDeletes(): void {
	for (const entry of deletes.values()) clearTimeout(entry.timer);
	deletes.clear();
}
