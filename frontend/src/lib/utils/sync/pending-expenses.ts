import type { OfflineExpense } from '$lib/utils/offline-storage';

/**
 * Is this outbox row still waiting to be delivered?
 *
 * SINGLE SOURCE OF TRUTH for the "pending sync" predicate, shared by every count the UI shows.
 * A row parked as `needsAttention` is unsynced but NOT pending: it is unsyncable as-is and the
 * sync loop deliberately skips it, so counting it produces a badge that offers a sync the app
 * will never perform — tapping it syncs the empty pending set, flashes "Synced", and the count
 * comes straight back. Parked rows are surfaced on their own, as "needs attention".
 *
 * Mirrors `getPendingExpenses`, which applies the same predicate to the persisted outbox;
 * `pending-expenses.test.ts` asserts the two agree so they cannot drift.
 */
export function isPendingSync(expense: OfflineExpense): boolean {
	return !expense.synced && !expense.needsAttention;
}

/** The complement of {@link isPendingSync} among unsynced rows: parked, awaiting the user. */
export function isParked(expense: OfflineExpense): boolean {
	return !expense.synced && expense.needsAttention === true;
}

export function countPendingSync(expenses: readonly OfflineExpense[]): number {
	return expenses.filter(isPendingSync).length;
}

export function countParked(expenses: readonly OfflineExpense[]): number {
	return expenses.filter(isParked).length;
}
