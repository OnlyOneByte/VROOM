import { describe, expect, it } from 'vitest';
import {
	frequencyLabel,
	hasTimeAxis,
	isMileageTracking,
	isReminderTimeDue,
	shouldTriggerRecurringExpenses
} from '../reminder-helpers';
import type { Reminder } from '$lib/types/reminder';

/**
 * Guard for the null-nextDueDate invariant (C22 backend rebuild made next_due_date nullable → C39
 * frontend). A pure-mileage reminder has nextDueDate=null; the time-due check must treat that as
 * NOT due — never feed it to `new Date(...)`, which yields the 1970 epoch and would mark every
 * mileage reminder wrongly "due". This pins isReminderTimeDue (extracted C48) so a future edit can't
 * re-introduce the unguarded deref.
 */

const NOW = Date.parse('2024-06-15T00:00:00.000Z');

function mk(overrides: Partial<Reminder>): Reminder {
	return {
		id: 'r1',
		userId: 'u1',
		name: 'Test',
		description: null,
		type: 'notification',
		actionMode: 'automatic',
		frequency: 'monthly',
		intervalValue: null,
		intervalUnit: null,
		triggerMode: 'time',
		intervalMileage: null,
		lastServiceOdometer: null,
		nextDueOdometer: null,
		startDate: '2024-01-01T00:00:00.000Z',
		endDate: null,
		nextDueDate: '2024-06-01T00:00:00.000Z',
		expenseCategory: null,
		expenseTags: null,
		expenseAmount: null,
		expenseDescription: null,
		expenseSplitConfig: null,
		isActive: true,
		lastTriggeredAt: null,
		createdAt: '2024-01-01T00:00:00.000Z',
		updatedAt: '2024-01-01T00:00:00.000Z',
		...overrides
	};
}

describe('isReminderTimeDue', () => {
	it('is due when nextDueDate is in the past', () => {
		expect(isReminderTimeDue(mk({ nextDueDate: '2024-06-01T00:00:00.000Z' }), NOW)).toBe(true);
	});

	it('is due when nextDueDate is exactly now', () => {
		expect(isReminderTimeDue(mk({ nextDueDate: '2024-06-15T00:00:00.000Z' }), NOW)).toBe(true);
	});

	it('is NOT due when nextDueDate is in the future', () => {
		expect(isReminderTimeDue(mk({ nextDueDate: '2024-07-01T00:00:00.000Z' }), NOW)).toBe(false);
	});

	it('a pure-mileage reminder (null nextDueDate) is NEVER time-due — the load-bearing guard', () => {
		// Without the null guard, `new Date(null)` is the 1970 epoch ≤ now → wrongly "due". This is
		// the exact crash/wrong-render the C39 nullable-type change introduced at the boundary.
		expect(isReminderTimeDue(mk({ triggerMode: 'mileage', nextDueDate: null }), NOW)).toBe(false);
	});
});

describe('isMileageTracking', () => {
	it('true for mileage and both, false for time', () => {
		expect(isMileageTracking(mk({ triggerMode: 'mileage' }))).toBe(true);
		expect(isMileageTracking(mk({ triggerMode: 'both' }))).toBe(true);
		expect(isMileageTracking(mk({ triggerMode: 'time' }))).toBe(false);
	});
});

describe('hasTimeAxis', () => {
	it('true for time and both, false for mileage', () => {
		expect(hasTimeAxis(mk({ triggerMode: 'time' }))).toBe(true);
		expect(hasTimeAxis(mk({ triggerMode: 'both' }))).toBe(true);
		expect(hasTimeAxis(mk({ triggerMode: 'mileage' }))).toBe(false);
	});
});

describe('frequencyLabel', () => {
	it('capitalizes a standard frequency for a time reminder', () => {
		expect(frequencyLabel(mk({ triggerMode: 'time', frequency: 'monthly' }))).toBe('Monthly');
		expect(frequencyLabel(mk({ triggerMode: 'time', frequency: 'yearly' }))).toBe('Yearly');
	});

	it('renders a custom interval (pluralizing > 1)', () => {
		expect(
			frequencyLabel(mk({ frequency: 'custom', intervalValue: 3, intervalUnit: 'month' }))
		).toBe('Every 3 months');
		expect(
			frequencyLabel(mk({ frequency: 'custom', intervalValue: 1, intervalUnit: 'week' }))
		).toBe('Every 1 week');
	});

	it('a both reminder keeps its real schedule label', () => {
		expect(frequencyLabel(mk({ triggerMode: 'both', frequency: 'weekly' }))).toBe('Weekly');
	});

	it('is null for a pure-mileage reminder — the inert stored frequency must NOT render', () => {
		// The load-bearing assertion: a pure-mileage reminder still carries frequency='monthly'
		// (backend requires one, the form sends its default), but the time axis is inert — showing
		// "Monthly" would be a lie. null lets the card omit the badge.
		expect(frequencyLabel(mk({ triggerMode: 'mileage', frequency: 'monthly' }))).toBeNull();
	});
});

describe('shouldTriggerRecurringExpenses (T5 opportunistic-materialization gate, C128)', () => {
	const base = { isAuthed: true, isOnline: true, lastRunMs: null as number | null, now: NOW };

	it('triggers when authed + online + never run before', () => {
		expect(shouldTriggerRecurringExpenses({ ...base, lastRunMs: null })).toBe(true);
	});

	it('does NOT trigger when not authed, or offline (regardless of lastRun)', () => {
		expect(shouldTriggerRecurringExpenses({ ...base, isAuthed: false })).toBe(false);
		expect(shouldTriggerRecurringExpenses({ ...base, isOnline: false })).toBe(false);
	});

	it('skips when the last run was already TODAY (the user local calendar day)', () => {
		// Earlier the same local day → debounced.
		const earlierToday = Date.parse('2024-06-15T06:30:00.000Z');
		expect(shouldTriggerRecurringExpenses({ ...base, lastRunMs: earlierToday })).toBe(false);
	});

	it('triggers when the last run was a PRIOR day', () => {
		const yesterday = Date.parse('2024-06-14T23:00:00.000Z');
		expect(shouldTriggerRecurringExpenses({ ...base, lastRunMs: yesterday })).toBe(true);
	});

	it('offline beats the never-run case (offline always skips)', () => {
		expect(
			shouldTriggerRecurringExpenses({ ...base, isOnline: false, lastRunMs: null })
		).toBe(false);
	});
});
