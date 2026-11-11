import type { Reminder } from '$lib/types/reminder';
import { capitalize } from './formatters';

export function isReminderTimeDue(reminder: Reminder, now: number = Date.now()): boolean {
	if (reminder.nextDueDate === null) return false;
	return new Date(reminder.nextDueDate).getTime() <= now;
}

export function isMileageTracking(reminder: Reminder): boolean {
	return reminder.triggerMode === 'mileage' || reminder.triggerMode === 'both';
}

export function shouldTriggerRecurringExpenses(opts: {
	isAuthed: boolean;
	isOnline: boolean;
	lastRunMs: number | null;
	now?: number;
}): boolean {
	if (!opts.isAuthed || !opts.isOnline) return false;
	const now = opts.now ?? Date.now();
	if (opts.lastRunMs === null) return true;
	const a = new Date(opts.lastRunMs);
	const b = new Date(now);
	const sameLocalDay =
		a.getFullYear() === b.getFullYear() &&
		a.getMonth() === b.getMonth() &&
		a.getDate() === b.getDate();
	return !sameLocalDay;
}

export const RECURRING_TRIGGER_TS_KEY = 'vroom_recurring_last_trigger';

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
		lastRunMs: lastRunMs !== null && Number.isFinite(lastRunMs) ? lastRunMs : null,
		now
	});
	if (!gate) return false;
	try {
		await opts.trigger();
		localStorage.setItem(RECURRING_TRIGGER_TS_KEY, String(now));
		return true;
	} catch {
		return false;
	}
}

export function hasTimeAxis(reminder: Reminder): boolean {
	return reminder.triggerMode === 'time' || reminder.triggerMode === 'both';
}

export function frequencyLabel(reminder: Reminder): string | null {
	if (!hasTimeAxis(reminder)) return null;
	const { frequency, intervalValue, intervalUnit } = reminder;
	if (frequency === 'custom' && intervalValue && intervalUnit) {
		return `Every ${intervalValue} ${intervalUnit}${intervalValue > 1 ? 's' : ''}`;
	}
	return capitalize(frequency);
}
