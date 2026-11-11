import { resolve } from '$app/paths';
import { paramRoutes } from '$lib/routes';
import { expenseApi } from '$lib/services/expense-api';
import type { Expense } from '$lib/types';

/** Insurance-generated expenses cannot be deleted here; the reason is visible text because a title on a disabled control is unreachable. */
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

/** Deleting one split sibling would orphan the rest, so route through the group-delete endpoint. */
export async function deleteExpenseRecord(expense: Expense): Promise<void> {
	if (expense.groupId) {
		await expenseApi.deleteSplitExpense(expense.groupId);
	} else {
		await expenseApi.deleteExpense(expense.id);
	}
}

export function deleteFailureMessage(error: unknown): string {
	return error instanceof Error ? error.message : 'Failed to delete expense';
}
