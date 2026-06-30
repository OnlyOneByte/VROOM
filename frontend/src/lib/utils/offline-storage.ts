import { offlineExpenseQueue, syncState } from '$lib/stores/offline.svelte';
import { toBackendExpense } from '$lib/services/api-transformer';
import { apiClient } from '$lib/services/api-client';
import { browser } from '$app/environment';
import type { ExpenseCategory } from '$lib/types';

const OFFLINE_STORAGE_KEY = 'vroom_offline_expenses';
const OFFLINE_STORAGE_VERSION = '3.0'; // v3: added clientId idempotency key

export interface OfflineExpense {
	id: string;
	/**
	 * Stable idempotency key sent to the backend on create. A retried POST with the
	 * same clientId returns the original server row instead of duplicating it, so
	 * sync is safe to retry without the fragile fuzzy duplicate-detection fallback.
	 * Optional only for legacy (pre-v3) persisted entries; `addOfflineExpense` always
	 * sets it and `loadOfflineExpenses` backfills it on read, so live entries always
	 * carry one before they are ever synced.
	 */
	clientId?: string;
	vehicleId: string;
	type?: string; // Deprecated, kept for backwards compatibility
	tags: string[]; // New flexible tags
	category: string; // Stored as string from user input; validated at sync time
	amount: number;
	currency?: string;
	date: string;
	mileage?: number;
	volume?: number; // For fuel expenses
	charge?: number; // For electric charging
	/**
	 * Fuel/charge type (e.g. 'Diesel', 'Electric', 'Level 2 (AC)'). MUST be carried in the
	 * outbox: the sync transform (toBackendExpense) decides volume-vs-charge SOLELY from
	 * isElectricFuelType(fuelType), so without it an offline ELECTRIC expense's `charge` is
	 * silently dropped on sync (isElectricFuelType(undefined)=false → the volume-only branch),
	 * and every synced expense loses its fuelType label (#66, NORTH_STAR #1/#2 data safety).
	 */
	fuelType?: string;
	/**
	 * Whether this fill-up follows a MISSED one (the user didn't log the previous fill-up). MUST be
	 * carried in the outbox: calculateAverageMpg pairs CONSECUTIVE fill-ups, and a missedFillup row is
	 * excluded from pairing — so dropping the flag on sync makes the next pair span a gap it shouldn't,
	 * computing an inflated/garbage MPG (#101, same offline field-dropout class as #66's fuelType,
	 * NORTH_STAR #1/#2). The online create path sends it; the offline path must too.
	 */
	missedFillup?: boolean;
	description?: string;
	timestamp: number;
	synced: boolean;
	/**
	 * Parked because the row is PERMANENTLY unsyncable (a malformed/incomplete entry that fails the same
	 * way on every attempt — e.g. a fuel row missing volume/charge or mileage, isIncompleteFuelExpense).
	 * Such a row must NOT be retried forever: it's excluded from getPendingExpenses (so syncAll stops
	 * re-attempting it) and surfaced via getNeedsAttentionExpenses for the user to fix or discard (#79).
	 * A transient (network/server) failure is NOT flagged — only a structural, self-resolving-impossible one.
	 */
	needsAttention?: boolean;
	version?: string; // Storage format version
}

/**
 * Map a stored offline-outbox entry to the backend request shape via the shared transformer.
 *
 * SINGLE SOURCE OF TRUTH for the OfflineExpense → toBackendExpense field mapping. This block was
 * copy-pasted at 3 sync sites (syncOfflineExpenses here + sync-manager's syncSingleExpense and
 * resolveConflict keep_local), and that drift is exactly how #66 happened — `fuelType` was added to
 * the online path but missed in the duplicated offline copies, so an offline electric expense's
 * `charge` silently vanished on sync (toBackendExpense routes charge↔volume SOLELY on fuelType).
 * Collapsing the three copies into one keeps the offline sync payload in lockstep, so a future field
 * can't be carried in one copy and forgotten in another. `tags` is a required `string[]` on
 * OfflineExpense, so no `|| []` guard is needed (the prior site-1 guard was a defensive no-op).
 */
export function offlineExpenseToBackend(
	expense: OfflineExpense
): ReturnType<typeof toBackendExpense> {
	return toBackendExpense({
		vehicleId: expense.vehicleId,
		tags: expense.tags,
		category: expense.category as ExpenseCategory,
		amount: expense.amount,
		date: expense.date,
		mileage: expense.mileage,
		volume: expense.volume,
		charge: expense.charge,
		fuelType: expense.fuelType,
		missedFillup: expense.missedFillup,
		description: expense.description
	});
}

/**
 * A fuel expense is INCOMPLETE for sync if it carries neither volume nor charge, OR has no mileage —
 * such a row can't yield a usable MPG/mi-kWh pairing and must not be POSTed. SINGLE SOURCE OF TRUTH for
 * this guard: the same predicate was hand-inlined at the two sync sites (syncOfflineExpenses here +
 * sync-manager's syncSingleExpense), the SAME offline↔sync fan-out whose drift caused #66/#101 — so a
 * future tightening (e.g. also requiring fuelType) can't land in one path and silently skip the other.
 * Each caller keeps its OWN action on a match (skip-and-continue vs return-an-error).
 */
export function isIncompleteFuelExpense(expense: OfflineExpense): boolean {
	return expense.category === 'fuel' && ((!expense.volume && !expense.charge) || !expense.mileage);
}

// Load offline expenses from localStorage
export function loadOfflineExpenses(): OfflineExpense[] {
	if (!browser) return [];

	try {
		const stored = localStorage.getItem(OFFLINE_STORAGE_KEY);
		if (!stored) return [];

		const expenses: OfflineExpense[] = JSON.parse(stored);

		// Migrate old format expenses to new format if needed
		return expenses.map(expense => {
			if (!expense.version || expense.version !== OFFLINE_STORAGE_VERSION) {
				// Backfill a clientId for pre-v3 entries so they sync idempotently.
				// MUST be DETERMINISTIC across reads: this migration runs on every read of a
				// not-yet-persisted legacy entry, so a `crypto.randomUUID()` fallback minted a
				// DIFFERENT key each time — defeating the very idempotency it backfills (a retried
				// POST after a lost response would carry a fresh clientId, the server couldn't dedup,
				// and the offline entry would duplicate). The entry's own `id` is already stable and
				// unique per entry, so it is the correct deterministic idempotency key.
				return {
					...expense,
					clientId: expense.clientId ?? expense.id,
					version: OFFLINE_STORAGE_VERSION
				};
			}
			return expense;
		});
	} catch (error) {
		if (import.meta.env.DEV) console.error('Failed to load offline expenses:', error);
		return [];
	}
}

// Save offline expenses to localStorage
export function saveOfflineExpenses(expenses: OfflineExpense[]): void {
	if (!browser) return;

	try {
		localStorage.setItem(OFFLINE_STORAGE_KEY, JSON.stringify(expenses));
		offlineExpenseQueue.current = expenses;
	} catch (error) {
		if (import.meta.env.DEV) console.error('Failed to save offline expenses:', error);
	}
}

// Add expense to offline queue
export function addOfflineExpense(
	expense: Omit<OfflineExpense, 'id' | 'clientId' | 'timestamp' | 'synced' | 'version'>
): void {
	const offlineExpense: OfflineExpense = {
		...expense,
		id: `offline_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
		clientId: crypto.randomUUID(),
		timestamp: Date.now(),
		synced: false,
		version: OFFLINE_STORAGE_VERSION
	};

	const currentExpenses = loadOfflineExpenses();
	const updatedExpenses = [...currentExpenses, offlineExpense];
	saveOfflineExpenses(updatedExpenses);
}

// Remove synced expense from offline queue
export function removeOfflineExpense(id: string): void {
	const currentExpenses = loadOfflineExpenses();
	const updatedExpenses = currentExpenses.filter(expense => expense.id !== id);
	saveOfflineExpenses(updatedExpenses);
}

// Get pending (unsynced) expenses. EXCLUDES rows parked as needsAttention (#79) — a permanently
// unsyncable malformed entry must not be silently re-attempted on every syncAll; it's surfaced
// separately via getNeedsAttentionExpenses for the user to fix/discard.
export function getPendingExpenses(): OfflineExpense[] {
	return loadOfflineExpenses().filter(expense => !expense.synced && !expense.needsAttention);
}

// Rows parked as permanently-unsyncable (#79) — surfaced to the user as "needs attention" (fix or
// discard) instead of being retried forever. Unsynced + flagged.
export function getNeedsAttentionExpenses(): OfflineExpense[] {
	return loadOfflineExpenses().filter(expense => !expense.synced && expense.needsAttention);
}

// Park a malformed/unsyncable expense as needs-attention (#79). Idempotent; a parked row drops out of
// getPendingExpenses so the sync loop stops re-attempting it. Clearing the flag (after the user edits
// it) is `clearNeedsAttention`, which re-admits the row to the pending set.
export function markExpenseNeedsAttention(id: string): void {
	const currentExpenses = loadOfflineExpenses();
	const updatedExpenses = currentExpenses.map(expense =>
		expense.id === id ? { ...expense, needsAttention: true } : expense
	);
	saveOfflineExpenses(updatedExpenses);
}

// Clear the needs-attention flag (e.g. after the user fixes the row) so it re-enters the pending set.
export function clearNeedsAttention(id: string): void {
	const currentExpenses = loadOfflineExpenses();
	const updatedExpenses = currentExpenses.map(expense =>
		expense.id === id ? { ...expense, needsAttention: false } : expense
	);
	saveOfflineExpenses(updatedExpenses);
}

// Mark expense as synced
export function markExpenseAsSynced(id: string): void {
	const currentExpenses = loadOfflineExpenses();
	const updatedExpenses = currentExpenses.map(expense =>
		expense.id === id ? { ...expense, synced: true } : expense
	);
	saveOfflineExpenses(updatedExpenses);
}

// Clear all synced expenses
export function clearSyncedExpenses(): void {
	const currentExpenses = loadOfflineExpenses();
	const pendingExpenses = currentExpenses.filter(expense => !expense.synced);
	saveOfflineExpenses(pendingExpenses);
}

// Sync offline expenses with server
export async function syncOfflineExpenses(): Promise<void> {
	const pendingExpenses = getPendingExpenses();

	if (pendingExpenses.length === 0) return;

	syncState.current = 'syncing';

	try {
		for (const expense of pendingExpenses) {
			// Validate fuel expense requirements. A malformed fuel row is PERMANENTLY unsyncable — park it as
			// needs-attention (#79) instead of `continue`-skipping it every run (the old behavior re-evaluated
			// + silently re-skipped it forever). Parking drops it from getPendingExpenses + surfaces it.
			if (isIncompleteFuelExpense(expense)) {
				if (import.meta.env.DEV) {
					console.warn(
						`Parking expense ${expense.id} (needs attention): fuel expenses require volume/charge and mileage`
					);
				}
				markExpenseNeedsAttention(expense.id);
				continue;
			}

			// Transform to backend format using the shared offline→backend mapper (#66 single source).
			const backendExpense = offlineExpenseToBackend(expense);

			// Send the idempotency key so a retried POST returns the original row.
			await apiClient.post('/api/v1/expenses', { ...backendExpense, clientId: expense.clientId });
			markExpenseAsSynced(expense.id);
		}

		clearSyncedExpenses();
		syncState.current = 'success';
		setTimeout(() => (syncState.current = 'idle'), 3000);
	} catch (error) {
		if (import.meta.env.DEV) console.error('Failed to sync offline expenses:', error);
		syncState.current = 'error';
		setTimeout(() => (syncState.current = 'idle'), 5000);
	}
}
