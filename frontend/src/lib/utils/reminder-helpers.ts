import type { Reminder } from '$lib/types/reminder';
import { capitalize } from './formatters';

/**
 * Whether a reminder is TIME-due: its nextDueDate is now or in the past.
 *
 * Critically null-safe: a pure-mileage reminder has a null nextDueDate (its due-ness is
 * odometer-based, evaluated server-side and surfaced via notifications), so it is NOT time-due and
 * must NOT be fed to `new Date(...)` — doing so yields `new Date(null)` = the epoch (1970), which
 * would wrongly mark every mileage reminder "due". This guard is the load-bearing invariant the
 * `nextDueDate: string | null` type introduced (C22 backend rebuild → C39 frontend); kept in one
 * tested place so a future caller can't re-introduce the unguarded `new Date(nextDueDate)` deref.
 *
 * `now` is injectable for deterministic tests.
 */
export function isReminderTimeDue(reminder: Reminder, now: number = Date.now()): boolean {
	if (reminder.nextDueDate === null) return false;
	return new Date(reminder.nextDueDate).getTime() <= now;
}

/** Whether a reminder tracks mileage (triggerMode mileage|both) — i.e. can be "marked serviced". */
export function isMileageTracking(reminder: Reminder): boolean {
	return reminder.triggerMode === 'mileage' || reminder.triggerMode === 'both';
}

/**
 * The opportunistic-materialization gate for recurring expenses (recurring-expenses T5/D1 — the pure
 * decision the app-init/focus hook calls before POSTing `reminderApi.trigger()`). Returns true only
 * when ALL hold: the user is authed, the browser is online, and the last trigger was NOT already today
 * (the user's LOCAL calendar day). The once-per-day debounce avoids hammering /trigger on every app
 * open while still materializing due recurring expenses promptly (D1: client-side, no cron).
 *
 * `lastRunMs` is the stored timestamp (localStorage) of the previous trigger, or null if never run.
 * `now`/`lastRunMs` are epoch ms and INJECTED → deterministic + host-independent (the same-local-day
 * comparison is done via local Y/M/D parts, sidestepping the C77 UTC-host vacuity trap). The eyes-on
 * hook owns reading/writing localStorage + the navigator.onLine/auth signals; this is just the policy.
 */
export function shouldTriggerRecurringExpenses(opts: {
	isAuthed: boolean;
	isOnline: boolean;
	lastRunMs: number | null;
	now?: number;
}): boolean {
	if (!opts.isAuthed || !opts.isOnline) return false;
	const now = opts.now ?? Date.now();
	if (opts.lastRunMs === null) return true; // never run → trigger
	const a = new Date(opts.lastRunMs);
	const b = new Date(now);
	const sameLocalDay =
		a.getFullYear() === b.getFullYear() &&
		a.getMonth() === b.getMonth() &&
		a.getDate() === b.getDate();
	return !sameLocalDay; // skip if already triggered today (the user's local calendar day)
}

/** localStorage key for the last opportunistic recurring-trigger timestamp (T5 once-per-day debounce). */
export const RECURRING_TRIGGER_TS_KEY = 'vroom_recurring_last_trigger';

/**
 * Opportunistic recurring-expenses materialization (recurring-expenses T5/D1 — the app-init hook).
 * Reads the last-trigger timestamp from localStorage, applies the pure `shouldTriggerRecurringExpenses`
 * gate (authed + online + not-already-today), and on a pass POSTs the trigger then stamps the timestamp
 * so it runs AT MOST once per local calendar day. Fail-soft: a trigger error is swallowed (this is a
 * best-effort background nudge — the user can still hit the manual "Run due reminders" button), and the
 * timestamp is only stamped AFTER a successful POST so a transient failure retries on the next app open.
 *
 * `trigger` is injected (the reminderApi.trigger fn) so the layout owns the import + this stays unit-
 * testable without the service/network. Returns whether a trigger was actually fired. No-op + false off
 * `browser` (no localStorage) or when the gate declines.
 */
export async function maybeTriggerRecurringExpenses(opts: {
	isAuthed: boolean;
	isOnline: boolean;
	isBrowser: boolean;
	trigger: () => Promise<unknown>;
	now?: number;
}): Promise<boolean> {
	if (!opts.isBrowser) return false;
	const now = opts.now ?? Date.now();
	const stored = localStorage.getItem(RECURRING_TRIGGER_TS_KEY);
	const lastRunMs = stored ? Number(stored) : null;
	const gate = shouldTriggerRecurringExpenses({
		isAuthed: opts.isAuthed,
		isOnline: opts.isOnline,
		// A corrupt/non-numeric stored value parses to NaN — treat it as "never run" (trigger) rather
		// than passing NaN into the gate's same-local-day Date math (new Date(NaN) → Invalid Date).
		lastRunMs: lastRunMs !== null && Number.isFinite(lastRunMs) ? lastRunMs : null,
		now
	});
	if (!gate) return false;
	try {
		await opts.trigger();
		// Stamp only on success so a failed POST retries next app open (don't burn the daily window).
		localStorage.setItem(RECURRING_TRIGGER_TS_KEY, String(now));
		return true;
	} catch {
		return false;
	}
}

/** Whether a reminder has a time axis (triggerMode time|both) — i.e. a recurrence schedule applies. */
export function hasTimeAxis(reminder: Reminder): boolean {
	return reminder.triggerMode === 'time' || reminder.triggerMode === 'both';
}

/**
 * Human label for a reminder's recurrence frequency — or null when there is no time axis.
 *
 * A pure-mileage reminder ('mileage') still carries a `frequency` column (the backend
 * `reminderBaseSchema` requires one and the form sends its 'monthly' default), but that schedule is
 * INERT — the engine drives the reminder purely by odometer and `nextDueDate` is null. Rendering the
 * stored frequency for such a reminder shows a misleading "Monthly" badge. Returns null so the caller
 * can omit the badge entirely for pure-mileage; 'both' keeps its real schedule label.
 */
export function frequencyLabel(reminder: Reminder): string | null {
	if (!hasTimeAxis(reminder)) return null;
	const { frequency, intervalValue, intervalUnit } = reminder;
	if (frequency === 'custom' && intervalValue && intervalUnit) {
		return `Every ${intervalValue} ${intervalUnit}${intervalValue > 1 ? 's' : ''}`;
	}
	return capitalize(frequency);
}
