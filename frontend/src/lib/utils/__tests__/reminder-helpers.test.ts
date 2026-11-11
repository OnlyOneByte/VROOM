import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	frequencyLabel,
	hasTimeAxis,
	isMileageTracking,
	isReminderTimeDue,
	maybeTriggerRecurringExpenses,
	RECURRING_TRIGGER_TS_KEY,
	shouldTriggerRecurringExpenses
} from '../reminder-helpers';
import type { Reminder } from '$lib/types/reminder';

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

	it('a pure-mileage reminder (null nextDueDate) is never time-due', () => {
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
		expect(frequencyLabel(mk({ triggerMode: 'mileage', frequency: 'monthly' }))).toBeNull();
	});
});

describe('shouldTriggerRecurringExpenses gate', () => {
	const NOW_LOCAL = new Date(2024, 5, 15, 12, 0, 0).getTime();
	const base = { isAuthed: true, isOnline: true, lastRunMs: null as number | null, now: NOW_LOCAL };

	it('triggers when authed + online + never run before', () => {
		expect(shouldTriggerRecurringExpenses({ ...base, lastRunMs: null })).toBe(true);
	});

	it('does NOT trigger when not authed, or offline (regardless of lastRun)', () => {
		expect(shouldTriggerRecurringExpenses({ ...base, isAuthed: false })).toBe(false);
		expect(shouldTriggerRecurringExpenses({ ...base, isOnline: false })).toBe(false);
	});

	it('skips when the last run was already TODAY (the user local calendar day)', () => {
		const earlierToday = new Date(2024, 5, 15, 6, 30, 0).getTime();
		expect(shouldTriggerRecurringExpenses({ ...base, lastRunMs: earlierToday })).toBe(false);
	});

	it('triggers when the last run was a PRIOR day', () => {
		const yesterday = new Date(2024, 5, 14, 23, 0, 0).getTime();
		expect(shouldTriggerRecurringExpenses({ ...base, lastRunMs: yesterday })).toBe(true);
	});

	it('offline beats the never-run case (offline always skips)', () => {
		expect(shouldTriggerRecurringExpenses({ ...base, isOnline: false, lastRunMs: null })).toBe(
			false
		);
	});
});

describe('maybeTriggerRecurringExpenses orchestration', () => {
	const NOW = new Date(2024, 5, 15, 12, 0, 0).getTime();

	beforeEach(() => {
		localStorage.clear();
	});

	it('triggers + stamps the timestamp when authed/online/never-run', async () => {
		const trigger = vi.fn().mockResolvedValue({ createdExpenses: [], notifications: [] });
		const fired = await maybeTriggerRecurringExpenses({
			isAuthed: true,
			isOnline: true,
			isBrowser: true,
			trigger,
			now: NOW
		});
		expect(fired).toBe(true);
		expect(trigger).toHaveBeenCalledTimes(1);
		expect(localStorage.getItem(RECURRING_TRIGGER_TS_KEY)).toBe(String(NOW));
	});

	it('does NOT trigger (or stamp) when the gate declines — already ran today', async () => {
		const earlierToday = new Date(2024, 5, 15, 6, 0, 0).getTime();
		localStorage.setItem(RECURRING_TRIGGER_TS_KEY, String(earlierToday));
		const trigger = vi.fn().mockResolvedValue({});
		const fired = await maybeTriggerRecurringExpenses({
			isAuthed: true,
			isOnline: true,
			isBrowser: true,
			trigger,
			now: NOW
		});
		expect(fired).toBe(false);
		expect(trigger).not.toHaveBeenCalled();
		expect(localStorage.getItem(RECURRING_TRIGGER_TS_KEY)).toBe(String(earlierToday));
	});

	it('does NOT trigger when offline / unauthed', async () => {
		const trigger = vi.fn().mockResolvedValue({});
		expect(
			await maybeTriggerRecurringExpenses({
				isAuthed: false,
				isOnline: true,
				isBrowser: true,
				trigger,
				now: NOW
			})
		).toBe(false);
		expect(
			await maybeTriggerRecurringExpenses({
				isAuthed: true,
				isOnline: false,
				isBrowser: true,
				trigger,
				now: NOW
			})
		).toBe(false);
		expect(trigger).not.toHaveBeenCalled();
	});

	it('does NOT stamp the timestamp when the trigger POST fails (retries next app open)', async () => {
		const trigger = vi.fn().mockRejectedValue(new Error('network'));
		const fired = await maybeTriggerRecurringExpenses({
			isAuthed: true,
			isOnline: true,
			isBrowser: true,
			trigger,
			now: NOW
		});
		expect(fired).toBe(false);
		expect(trigger).toHaveBeenCalledTimes(1);
		expect(localStorage.getItem(RECURRING_TRIGGER_TS_KEY)).toBeNull();
	});

	it('is a no-op off the browser (no localStorage / SSR)', async () => {
		const trigger = vi.fn().mockResolvedValue({});
		const fired = await maybeTriggerRecurringExpenses({
			isAuthed: true,
			isOnline: true,
			isBrowser: false,
			trigger,
			now: NOW
		});
		expect(fired).toBe(false);
		expect(trigger).not.toHaveBeenCalled();
	});

	it('treats a corrupt stored timestamp as never-run (triggers, does not pass NaN to the gate)', async () => {
		localStorage.setItem(RECURRING_TRIGGER_TS_KEY, 'not-a-number');
		const trigger = vi.fn().mockResolvedValue({});
		const fired = await maybeTriggerRecurringExpenses({
			isAuthed: true,
			isOnline: true,
			isBrowser: true,
			trigger,
			now: NOW
		});
		expect(fired).toBe(true);
		expect(trigger).toHaveBeenCalledTimes(1);
	});
});

describe('maybeTriggerRecurringExpenses orchestration', () => {
	const NOW = Date.parse('2024-06-15T12:00:00.000Z');

	beforeEach(() => {
		localStorage.clear();
	});

	it('triggers + stamps the timestamp when authed/online/never-run', async () => {
		const trigger = vi.fn().mockResolvedValue({ createdExpenses: [], notifications: [] });
		const fired = await maybeTriggerRecurringExpenses({
			isAuthed: true,
			isOnline: true,
			isBrowser: true,
			trigger,
			now: NOW
		});
		expect(fired).toBe(true);
		expect(trigger).toHaveBeenCalledTimes(1);
		expect(localStorage.getItem(RECURRING_TRIGGER_TS_KEY)).toBe(String(NOW));
	});

	it('does NOT trigger (or stamp) when the gate declines — already ran today', async () => {
		const earlierToday = Date.parse('2024-06-15T06:00:00.000Z');
		localStorage.setItem(RECURRING_TRIGGER_TS_KEY, String(earlierToday));
		const trigger = vi.fn().mockResolvedValue({});
		const fired = await maybeTriggerRecurringExpenses({
			isAuthed: true,
			isOnline: true,
			isBrowser: true,
			trigger,
			now: NOW
		});
		expect(fired).toBe(false);
		expect(trigger).not.toHaveBeenCalled();
		expect(localStorage.getItem(RECURRING_TRIGGER_TS_KEY)).toBe(String(earlierToday));
	});

	it('does NOT trigger when offline / unauthed', async () => {
		const trigger = vi.fn().mockResolvedValue({});
		expect(
			await maybeTriggerRecurringExpenses({
				isAuthed: false,
				isOnline: true,
				isBrowser: true,
				trigger,
				now: NOW
			})
		).toBe(false);
		expect(
			await maybeTriggerRecurringExpenses({
				isAuthed: true,
				isOnline: false,
				isBrowser: true,
				trigger,
				now: NOW
			})
		).toBe(false);
		expect(trigger).not.toHaveBeenCalled();
	});

	it('does NOT stamp the timestamp when the trigger POST fails (retries next app open)', async () => {
		const trigger = vi.fn().mockRejectedValue(new Error('network'));
		const fired = await maybeTriggerRecurringExpenses({
			isAuthed: true,
			isOnline: true,
			isBrowser: true,
			trigger,
			now: NOW
		});
		expect(fired).toBe(false);
		expect(trigger).toHaveBeenCalledTimes(1);
		expect(localStorage.getItem(RECURRING_TRIGGER_TS_KEY)).toBeNull();
	});

	it('is a no-op off the browser (no localStorage / SSR)', async () => {
		const trigger = vi.fn().mockResolvedValue({});
		const fired = await maybeTriggerRecurringExpenses({
			isAuthed: true,
			isOnline: true,
			isBrowser: false,
			trigger,
			now: NOW
		});
		expect(fired).toBe(false);
		expect(trigger).not.toHaveBeenCalled();
	});

	it('treats a corrupt stored timestamp as never-run (triggers, does not pass NaN to the gate)', async () => {
		localStorage.setItem(RECURRING_TRIGGER_TS_KEY, 'not-a-number');
		const trigger = vi.fn().mockResolvedValue({});
		const fired = await maybeTriggerRecurringExpenses({
			isAuthed: true,
			isOnline: true,
			isBrowser: true,
			trigger,
			now: NOW
		});
		expect(fired).toBe(true);
		expect(trigger).toHaveBeenCalledTimes(1);
	});
});
