import type { OfflineExpense } from '$lib/utils/offline-storage';

export function isPendingSync(expense: OfflineExpense): boolean {
	return !expense.synced && !expense.needsAttention;
}

export function isParked(expense: OfflineExpense): boolean {
	return !expense.synced && expense.needsAttention === true;
}

export function countPendingSync(expenses: readonly OfflineExpense[]): number {
	return expenses.filter(isPendingSync).length;
}

export function countParked(expenses: readonly OfflineExpense[]): number {
	return expenses.filter(isParked).length;
}
