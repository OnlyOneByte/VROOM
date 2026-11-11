import { offlineExpenseQueue, syncState } from '$lib/stores/offline.svelte';
import { toBackendExpense } from '$lib/services/api-transformer';
import { apiClient } from '$lib/services/api-client';
import { classifySyncFailure } from '$lib/utils/sync/classify-failure';
import { extractErrorMessage } from '$lib/utils/error-handling';
import { browser } from '$app/environment';
import type { ExpenseCategory } from '$lib/types';

const OFFLINE_STORAGE_KEY = 'vroom_offline_expenses';
/** Sibling key holding the last unparseable outbox blob, so a corrupt read cannot erase it. */
const CORRUPT_STORAGE_KEY = 'vroom_offline_expenses.corrupt';
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
	 * and every synced expense loses its fuelType label (data safety).
	 */
	fuelType?: string;
	/**
	 * Whether this fill-up follows a MISSED one (the user didn't log the previous fill-up). MUST be
	 * carried in the outbox: calculateAverageMpg pairs CONSECUTIVE fill-ups, and a missedFillup row is
	 * excluded from pairing — so dropping the flag on sync makes the next pair span a gap it shouldn't,
	 * computing an inflated/garbage MPG (same offline field-dropout class as's fuelType,
	 * ). The online create path sends it; the offline path must too.
	 */
	missedFillup?: boolean;
	description?: string;
	timestamp: number;
	synced: boolean;
	/**
	 * Parked because the row is unsyncable AS-IS and fails the same way on every attempt — either a
	 * malformed/incomplete entry (a fuel row missing volume/charge or mileage, isIncompleteFuelExpense)
	 * or a row the server itself rejected with a 4xx verdict. Such a row must NOT be retried forever:
	 * it's excluded from getPendingExpenses (so syncAll stops re-attempting it) and surfaced via
	 * getNeedsAttentionExpenses for the user to fix or discard. A transient (network/server) failure is
	 * NOT flagged — only one that cannot resolve itself.
	 */
	needsAttention?: boolean;
	/**
	 * Why this row was parked, in the user's terms. Set alongside `needsAttention` because the two
	 * reasons read nothing alike ("add the missing volume and mileage" vs the server's own rejection),
	 * and a parked row the user cannot explain is a parked row they cannot fix.
	 */
	attentionReason?: string;
	version?: string; // Storage format version
}

/**
 * Map a stored offline-outbox entry to the backend request shape via the shared transformer.
 *
 * SINGLE SOURCE OF TRUTH for the OfflineExpense → toBackendExpense field mapping. This block was
 * copy-pasted at 3 sync sites (syncOfflineExpenses here + sync-manager's syncSingleExpense and
 * resolveConflict keep_local), and that drift is exactly how happened — `fuelType` was added to
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
 * sync-manager's syncSingleExpense), the SAME offline↔sync fan-out whose drift caused — so a
 * future tightening (e.g. also requiring fuelType) can't land in one path and silently skip the other.
 * Each caller keeps its OWN action on a match (skip-and-continue vs return-an-error).
 */
export function isIncompleteFuelExpense(expense: OfflineExpense): boolean {
	return expense.category === 'fuel' && ((!expense.volume && !expense.charge) || !expense.mileage);
}

/**
 * What to tell the user about a row parked by the predicate above. Lives beside it so the explanation
 * and the condition it explains cannot drift — both sync paths park with this exact wording.
 */
export const INCOMPLETE_FUEL_REASON =
	'Fuel expenses require volume/charge and mileage data. Please edit the expense and add the missing information.';

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
		// An unparseable blob is about to be overwritten by the next write (which builds on the []
		// returned here), so copy the raw bytes aside first — they are the only remaining trace of
		// whatever was queued. Best-effort by construction: when the trigger is a blocked/full
		// localStorage this write throws too, and there is nothing else to preserve it in.
		stashCorruptedBlob();
		return [];
	}
}

/**
 * Preserve the raw, unparseable outbox blob under a sibling key so the next write cannot destroy it.
 * Deliberately silent on failure: this is a forensic copy, and a caller recovering from corruption
 * must not be blocked by a second storage error.
 */
function stashCorruptedBlob(): void {
	try {
		const raw = localStorage.getItem(OFFLINE_STORAGE_KEY);
		if (raw) localStorage.setItem(CORRUPT_STORAGE_KEY, raw);
	} catch {
		// Storage is unavailable — the blob is unrecoverable either way.
	}
}

/**
 * Persist the outbox. Returns whether the rows are actually on disk: `localStorage.setItem` throws
 * when site data is blocked (SecurityError) or the quota is exhausted (QuotaExceededError), and a
 * caller that has just promised the user "saved offline" MUST be able to see that it did not happen
 * — the one thing this app may never do is drop a write and report success.
 *
 * The in-memory mirror is updated ONLY on a successful write, so the pending badge can never show a
 * row that no reload will bring back.
 *
 * The flag-mutating callers below (synced / needs-attention / removal) deliberately ignore the
 * result: a lost flag costs at most one idempotent re-POST, which the clientId key makes harmless.
 * The ADD path is the only one where a false return means user data is gone, and it propagates it.
 */
export function saveOfflineExpenses(expenses: OfflineExpense[]): boolean {
	if (!browser) return false;

	try {
		localStorage.setItem(OFFLINE_STORAGE_KEY, JSON.stringify(expenses));
	} catch (error) {
		if (import.meta.env.DEV) console.error('Failed to save offline expenses:', error);
		return false;
	}

	offlineExpenseQueue.current = expenses;
	return true;
}

/** Queue an expense for later sync. Returns false when the write did not persist — see above. */
export function addOfflineExpense(
	expense: Omit<OfflineExpense, 'id' | 'clientId' | 'timestamp' | 'synced' | 'version'>
): boolean {
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
	return saveOfflineExpenses(updatedExpenses);
}

// Remove synced expense from offline queue
export function removeOfflineExpense(id: string): void {
	const currentExpenses = loadOfflineExpenses();
	const updatedExpenses = currentExpenses.filter(expense => expense.id !== id);
	saveOfflineExpenses(updatedExpenses);
}

// Get pending (unsynced) expenses. EXCLUDES rows parked as needsAttention — a permanently
// unsyncable malformed entry must not be silently re-attempted on every syncAll; it's surfaced
// separately via getNeedsAttentionExpenses for the user to fix/discard.
export function getPendingExpenses(): OfflineExpense[] {
	return loadOfflineExpenses().filter(expense => !expense.synced && !expense.needsAttention);
}

// Rows parked as permanently-unsyncable — surfaced to the user as "needs attention" (fix or
// discard) instead of being retried forever. Unsynced + flagged.
export function getNeedsAttentionExpenses(): OfflineExpense[] {
	return loadOfflineExpenses().filter(expense => !expense.synced && expense.needsAttention);
}

// Park an unsyncable expense as needs-attention, with the reason to show the user. Idempotent; a
// parked row drops out of getPendingExpenses so the sync loop stops re-attempting it. Clearing the
// flag (after the user edits it) is `clearNeedsAttention`, which re-admits the row to the pending set.
export function markExpenseNeedsAttention(id: string, reason?: string): void {
	const currentExpenses = loadOfflineExpenses();
	const updatedExpenses = currentExpenses.map(expense =>
		expense.id === id
			? {
					...expense,
					needsAttention: true,
					...(reason !== undefined && { attentionReason: reason })
				}
			: expense
	);
	saveOfflineExpenses(updatedExpenses);
}

// Clear the needs-attention flag (e.g. after the user fixes the row) so it re-enters the pending set.
// The reason goes with it — a row back in the pending set has nothing left to explain.
export function clearNeedsAttention(id: string): void {
	const currentExpenses = loadOfflineExpenses();
	const updatedExpenses = currentExpenses.map(expense =>
		expense.id === id ? { ...expense, needsAttention: false, attentionReason: undefined } : expense
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

	// Per-row error handling, not one try around the loop: a row the server rejects deterministically
	// must be parked rather than retried forever, and it must not block the rows behind it.
	let failed = 0;

	try {
		for (const expense of pendingExpenses) {
			// Validate fuel expense requirements. A malformed fuel row is PERMANENTLY unsyncable — park it as
			// needs-attention instead of `continue`-skipping it every run (the old behavior re-evaluated
			// + silently re-skipped it forever). Parking drops it from getPendingExpenses + surfaces it.
			if (isIncompleteFuelExpense(expense)) {
				if (import.meta.env.DEV) {
					console.warn(
						`Parking expense ${expense.id} (needs attention): fuel expenses require volume/charge and mileage`
					);
				}
				markExpenseNeedsAttention(expense.id, INCOMPLETE_FUEL_REASON);
				continue;
			}

			// Transform to backend format using the shared offline→backend mapper (single source).
			const backendExpense = offlineExpenseToBackend(expense);

			try {
				// Send the idempotency key so a retried POST returns the original row.
				await apiClient.post('/api/v1/expenses', {
					...backendExpense,
					clientId: expense.clientId
				});
				markExpenseAsSynced(expense.id);
			} catch (error) {
				const kind = classifySyncFailure(error);
				if (kind === 'terminal') {
					// The server examined this row and rejected it; the same POST will be rejected
					// identically forever. Park it so it leaves the pending queue and is surfaced.
					markExpenseNeedsAttention(
						expense.id,
						extractErrorMessage(error, 'The server rejected this entry')
					);
				} else {
					// transient or auth — keep it pending so a later run (or the next sign-in) delivers it.
					failed++;
				}
				if (import.meta.env.DEV) {
					console.error(`Failed to sync expense ${expense.id} (${kind}):`, error);
				}
			}
		}

		clearSyncedExpenses();
		syncState.current = failed > 0 ? 'error' : 'success';
		setTimeout(() => (syncState.current = 'idle'), failed > 0 ? 5000 : 3000);
	} catch (error) {
		if (import.meta.env.DEV) console.error('Failed to sync offline expenses:', error);
		syncState.current = 'error';
		setTimeout(() => (syncState.current = 'idle'), 5000);
	}
}
