import { SvelteMap } from 'svelte/reactivity';
import { appStore } from '#lib/stores/app.svelte.ts';
import { expenseApi } from '#lib/services/expense-api.ts';
import type { Expense } from '#lib/types/index.ts';
import { ApiError, userFacingErrorMessage } from '#lib/utils/error-handling.ts';
import type { PendingRowState } from '#lib/utils/sync/pending-rows.ts';
import { UNDO_WINDOW_MS } from '#lib/utils/pending-deletes.svelte.ts';

type EditPayload = Parameters<typeof expenseApi.updateExpense>[1];

interface PendingEdit {
	before: Expense;
	after: Expense;
	payload: EditPayload;
	status: 'saving' | 'saved' | 'failed' | 'conflict';
	error?: string;
	seq: number;
	savedAt?: string;
	undo?: boolean;
	undoneAt?: string;
	undoSeq?: number;
	expected?: string | null;
	currentUpdatedAt?: string | null;
}

export const EXPENSE_CHANGED_MESSAGE = 'This expense changed elsewhere';

const toastId = (id: string) => `expense-edit-${id}`;

const edits = new SvelteMap<string, PendingEdit>();
const inFlight = new SvelteMap<string, Promise<void>>();
const versions = new SvelteMap<string, string>();
const latest = new SvelteMap<string, Expense>();
let nextSeq = 0;

function noteVersion(id: string, updatedAt: string | undefined): void {
	const known = versions.get(id);
	if (updatedAt && (!known || updatedAt > known)) versions.set(id, updatedAt);
}

function settle(id: string, seq: number, change: Partial<PendingEdit>): boolean {
	const entry = edits.get(id);
	if (entry?.seq !== seq) return false;
	edits.set(id, { ...entry, ...change });
	return true;
}

function changedElsewhere(error: unknown): { updatedAt: string | null } | null {
	if (!(error instanceof ApiError) || error.code !== 'EXPENSE_CHANGED') return null;
	const current = error.details?.['updatedAt'];
	return { updatedAt: typeof current === 'string' ? current : null };
}

function reportConflict(id: string, seq: number, updatedAt: string | null): void {
	if (
		!settle(id, seq, {
			status: 'conflict',
			error: EXPENSE_CHANGED_MESSAGE,
			currentUpdatedAt: updatedAt
		})
	)
		return;
	appStore.addNotification({
		type: 'error',
		message: EXPENSE_CHANGED_MESSAGE,
		description:
			'Apply your changes on top of the newer version, or use Reload on the expense to see it.',
		toastId: toastId(id),
		duration: Number.POSITIVE_INFINITY,
		action: { label: 'Apply my changes', onClick: () => applyMyChanges(id) }
	});
}

async function put(id: string, seq: number, payload: EditPayload): Promise<void> {
	const sending = edits.get(id);
	const unchecked = sending?.seq === seq && sending.expected === null;
	const expectedUpdatedAt = unchecked ? undefined : versions.get(id);
	try {
		const saved: Expense | undefined = await expenseApi.updateExpense(id, payload, {
			expectedUpdatedAt
		});
		const stamp = saved?.updatedAt;
		noteVersion(id, stamp);
		const entry = edits.get(id);
		if (!entry) return;
		if (entry.seq === seq) {
			edits.set(id, { ...entry, status: 'saved', ...(!entry.undo && stamp && { savedAt: stamp }) });
		} else if (entry.undo && entry.undoSeq === seq && !entry.undoneAt && stamp) {
			edits.set(id, { ...entry, undoneAt: stamp });
		}
	} catch (error) {
		const conflict = changedElsewhere(error);
		if (conflict) {
			reportConflict(id, seq, conflict.updatedAt);
			return;
		}
		const reason = userFacingErrorMessage(error);
		if (!settle(id, seq, { status: 'failed', error: reason })) return;
		appStore.addNotification({
			type: 'error',
			message: edits.get(id)?.undo
				? "Couldn't undo your changes to the expense"
				: "Your changes to the expense weren't saved",
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

export function scheduleEdit(
	before: Expense,
	after: Expense,
	payload: EditPayload,
	toast: { message: string; description?: string | undefined } = {
		message: 'Expense updated successfully'
	}
): void {
	noteVersion(before.id, before.updatedAt);
	edits.set(before.id, { before, after, payload, status: 'saving', seq: ++nextSeq });
	appStore.addNotification({
		type: 'success',
		...toast,
		toastId: toastId(before.id),
		duration: UNDO_WINDOW_MS,
		action: { label: 'Undo', onClick: () => undoEdit(before.id) }
	});
	send(before.id);
}

function restorePayload({ before, payload }: PendingEdit): EditPayload {
	return {
		vehicleId: before.vehicleId,
		tags: before.tags,
		category: before.category,
		amount: before.amount,
		date: before.date,
		mileage: before.mileage,
		volume: before.volume,
		charge: before.charge,
		fuelType: before.fuelType,
		description: before.description,
		location: before.location,
		currency: before.currency,
		missedFillup: before.missedFillup,
		...(payload.sourceType === null &&
			before.sourceType === 'financing' &&
			before.sourceId && { sourceType: before.sourceType, sourceId: before.sourceId }),
		...('paidByDriverId' in payload && { paidByDriverId: before.paidByDriverId ?? null })
	};
}

export function undoEdit(id: string): void {
	const entry = edits.get(id);
	if (!entry || entry.undo) return;
	appStore.dismissToast(toastId(id));
	edits.set(id, {
		before: entry.before,
		after: entry.before,
		payload: restorePayload(entry),
		status: 'saving',
		seq: ++nextSeq,
		undo: true,
		undoSeq: entry.seq,
		...(entry.savedAt && { undoneAt: entry.savedAt })
	});
	send(id);
}

export function retryEdit(id: string): void {
	const entry = edits.get(id);
	if (entry?.status !== 'failed') return;
	appStore.dismissToast(toastId(id));
	edits.set(id, { ...entry, status: 'saving', error: undefined, seq: ++nextSeq });
	send(id);
}

export function applyMyChanges(id: string): void {
	const entry = edits.get(id);
	if (entry?.status !== 'conflict') return;
	appStore.dismissToast(toastId(id));
	noteVersion(id, entry.currentUpdatedAt ?? undefined);
	edits.set(id, {
		...entry,
		status: 'saving',
		error: undefined,
		seq: ++nextSeq,
		expected: entry.currentUpdatedAt ? undefined : null
	});
	send(id);
}

export async function reloadLatest(id: string): Promise<void> {
	const entry = edits.get(id);
	if (entry?.status !== 'conflict') return;
	try {
		const fresh = await expenseApi.getExpense(id);
		if (edits.get(id) !== entry) return;
		appStore.dismissToast(toastId(id));
		edits.delete(id);
		latest.set(id, fresh);
		noteVersion(id, fresh.updatedAt);
	} catch (error) {
		appStore.addNotification({
			type: 'error',
			message: "Couldn't load the latest version of the expense",
			description: userFacingErrorMessage(error)
		});
	}
}

function withLatest<T extends Expense>(expense: T): T {
	const fresh = latest.get(expense.id);
	if (!fresh || (expense.updatedAt && fresh.updatedAt < expense.updatedAt)) return expense;
	return { ...expense, ...fresh };
}

function covers(entry: PendingEdit, expense: Expense): boolean {
	if (expense.updatedAt === entry.before.updatedAt) return true;
	if (entry.currentUpdatedAt && expense.updatedAt === entry.currentUpdatedAt) return true;
	return entry.undo === true && expense.updatedAt === entry.undoneAt;
}

function overlay(expense: Expense): PendingEdit | undefined {
	const entry = edits.get(expense.id);
	if (!entry || entry.status === 'failed' || entry.status === 'conflict') return undefined;
	return covers(entry, expense) ? entry : undefined;
}

export function shownExpense<T extends Expense>(listed: T): T {
	const expense = withLatest(listed);
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
		if ((entry?.status === 'failed' || entry?.status === 'conflict') && covers(entry, expense)) {
			states.push([
				expense.id,
				{
					status: 'failed',
					kind: 'edit',
					error: entry.error ?? '',
					...(entry.status === 'conflict' && { conflict: true })
				}
			]);
		}
	}
	return states;
}

export function resetPendingEdits(): void {
	edits.clear();
	inFlight.clear();
	versions.clear();
	latest.clear();
}
