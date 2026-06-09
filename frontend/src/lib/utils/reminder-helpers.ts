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
	return frequency.charAt(0).toUpperCase() + frequency.slice(1);
}
