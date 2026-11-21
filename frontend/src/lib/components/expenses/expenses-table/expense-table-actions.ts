import { resolve } from '$app/paths';
import { paramRoutes } from '#lib/routes.ts';
import { expenseApi } from '#lib/services/expense-api.ts';
import type { Expense } from '#lib/types/index.ts';
import { userFacingErrorMessage } from '#lib/utils/error-handling.ts';

// A title on a disabled control is unreachable, so the blocked reason must stay visible text.
export const INSURANCE_DELETE_BLOCKED = 'Delete the insurance policy to remove this expense';

export function isInsuranceLinked(tags: readonly string[]): boolean {
	return tags.includes('insurance');
}

export function blockedReasonId(groupId: string): string {
	return `expense-delete-blocked-${groupId}`;
}

export function expenseEditHref(expenseId: string, returnTo: string): string {
	return `${resolve(paramRoutes.expenseEdit, { id: expenseId })}?returnTo=${returnTo}`;
}

export async function deleteExpenseRecord(expense: Expense): Promise<void> {
	if (expense.groupId) {
		await expenseApi.deleteSplitExpense(expense.groupId);
	} else {
		await expenseApi.deleteExpense(expense.id);
	}
}

export function deleteFailureMessage(error: unknown): string {
	return `Couldn't delete the expense. ${userFacingErrorMessage(error)}`;
}

export const EXPENSE_DELETED_MESSAGE = 'Expense deleted successfully';
export const REFRESH_AFTER_DELETE_FAILED =
	"Expense deleted, but the list couldn't refresh. Reload the page to see the latest.";

export interface DeleteNotice {
	type: 'success' | 'warning' | 'error';
	message: string;
}

export async function deleteAndRefresh(
	expense: Expense,
	refresh: (_expense: Expense) => Promise<void>
): Promise<DeleteNotice> {
	try {
		await deleteExpenseRecord(expense);
	} catch (error) {
		return { type: 'error', message: deleteFailureMessage(error) };
	}
	try {
		await refresh(expense);
	} catch {
		return { type: 'warning', message: REFRESH_AFTER_DELETE_FAILED };
	}
	return { type: 'success', message: EXPENSE_DELETED_MESSAGE };
}
