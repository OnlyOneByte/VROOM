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
