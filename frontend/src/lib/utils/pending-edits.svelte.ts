import { SvelteMap } from 'svelte/reactivity';
import { appStore } from '#lib/stores/app.svelte.ts';
import { expenseApi } from '#lib/services/expense-api.ts';
import type { Expense } from '#lib/types/index.ts';
import { userFacingErrorMessage } from '#lib/utils/error-handling.ts';
import type { PendingRowState } from '#lib/utils/sync/pending-rows.ts';

type EditPayload = Parameters<typeof expenseApi.updateExpense>[1];

interface PendingEdit {
	before: Expense;
	after: Expense;
	payload: EditPayload;
	status: 'saving' | 'saved' | 'failed';
	error?: string;
}

const toastId = (id: string) => `expense-edit-${id}`;

const edits = new SvelteMap<string, PendingEdit>();

function update(id: string, change: Partial<PendingEdit>): void {
	const entry = edits.get(id);
	if (entry) edits.set(id, { ...entry, ...change });
}

async function send(id: string): Promise<void> {
	const entry = edits.get(id);
	if (!entry) return;
	try {
		await expenseApi.updateExpense(id, entry.payload);
		update(id, { status: 'saved' });
	} catch (error) {
		const reason = userFacingErrorMessage(error);
		update(id, { status: 'failed', error: reason });
		appStore.addNotification({
			type: 'error',
			message: "Your changes to the expense weren't saved",
			description: reason,
			toastId: toastId(id),
			duration: Number.POSITIVE_INFINITY,
			action: { label: 'Retry', onClick: () => retryEdit(id) }
		});
	}
}

export function scheduleEdit(before: Expense, after: Expense, payload: EditPayload): void {
	appStore.dismissToast(toastId(before.id));
	edits.set(before.id, { before, after, payload, status: 'saving' });
	void send(before.id);
}

export function retryEdit(id: string): void {
	if (edits.get(id)?.status !== 'failed') return;
	appStore.dismissToast(toastId(id));
	update(id, { status: 'saving', error: undefined });
	void send(id);
}

function overlay(expense: Expense): PendingEdit | undefined {
	const entry = edits.get(expense.id);
	if (!entry || entry.status === 'failed') return undefined;
	return entry.before.updatedAt === expense.updatedAt ? entry : undefined;
}

export function shownExpense<T extends Expense>(expense: T): T {
	const entry = overlay(expense);
	return entry ? { ...expense, ...entry.after } : expense;
}

export function editedRows(expenses: readonly Expense[]): { before: Expense[]; after: Expense[] } {
	const before: Expense[] = [];
	const after: Expense[] = [];
	for (const expense of expenses) {
		const entry = overlay(expense);
		if (entry) {
			before.push(expense);
			after.push({ ...expense, ...entry.after });
		}
	}
	return { before, after };
}

export function editFailureStates(expenses: readonly Expense[]): [string, PendingRowState][] {
	const states: [string, PendingRowState][] = [];
	for (const expense of expenses) {
		const entry = edits.get(expense.id);
		if (entry?.status === 'failed') {
			states.push([expense.id, { status: 'failed', kind: 'edit', error: entry.error ?? '' }]);
		}
	}
	return states;
}

export function resetPendingEdits(): void {
	edits.clear();
}
