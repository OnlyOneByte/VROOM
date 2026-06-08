import type { Reminder } from '$lib/types/reminder';

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
