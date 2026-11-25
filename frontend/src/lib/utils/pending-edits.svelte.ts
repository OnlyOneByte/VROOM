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
	seq: number;
}

const toastId = (id: string) => `expense-edit-${id}`;

const edits = new SvelteMap<string, PendingEdit>();
const inFlight = new SvelteMap<string, Promise<void>>();
let nextSeq = 0;

function settle(id: string, seq: number, change: Partial<PendingEdit>): boolean {
	const entry = edits.get(id);
	if (entry?.seq !== seq) return false;
	edits.set(id, { ...entry, ...change });
	return true;
}

async function put(id: string, seq: number, payload: EditPayload): Promise<void> {
	try {
		await expenseApi.updateExpense(id, payload);
		settle(id, seq, { status: 'saved' });
	} catch (error) {
		const reason = userFacingErrorMessage(error);
		if (!settle(id, seq, { status: 'failed', error: reason })) return;
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

function send(id: string): void {
	const entry = edits.get(id);
	if (!entry) return;
	const { seq, payload } = entry;
	const previous = inFlight.get(id) ?? Promise.resolve();
	const next = previous.then(() => put(id, seq, payload));
	inFlight.set(id, next);
	void next.finally(() => {
		if (inFlight.get(id) === next) inFlight.delete(id);
	});
}

export function scheduleEdit(before: Expense, after: Expense, payload: EditPayload): void {
	edits.set(before.id, { before, after, payload, status: 'saving', seq: ++nextSeq });
	appStore.addNotification({
		type: 'success',
		message: 'Expense updated successfully',
		toastId: toastId(before.id)
	});
	send(before.id);
}

export function retryEdit(id: string): void {
	const entry = edits.get(id);
	if (entry?.status !== 'failed') return;
	appStore.dismissToast(toastId(id));
	edits.set(id, { ...entry, status: 'saving', error: undefined, seq: ++nextSeq });
	send(id);
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
		if (entry?.status === 'failed' && entry.before.updatedAt === expense.updatedAt) {
			states.push([expense.id, { status: 'failed', kind: 'edit', error: entry.error ?? '' }]);
		}
	}
	return states;
}

export function resetPendingEdits(): void {
	edits.clear();
	inFlight.clear();
}
