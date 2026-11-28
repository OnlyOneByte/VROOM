import { afterEach, describe, expect, test } from 'vitest';
import { cleanup, render, screen } from '@testing-library/svelte';
import { ReminderFormState } from '../reminder-form/reminder-form-state.svelte';
import {
	makeReminderWithVehicles,
	makeVehicle
} from '../reminder-form/__tests__/reminder-form-fixtures.ts';

const ScheduleFields = (await import('../reminder-form/ReminderScheduleFields.svelte')).default;

function renderNew(changes: Partial<ReminderFormState['values']> = {}): ReminderFormState {
	const form = new ReminderFormState();
	form.load(null, [makeVehicle('v1')]);
	Object.assign(form.values, changes);
	render(ScheduleFields, { props: { form } });
	return form;
}

function hint(): string | null {
	return document.getElementById('reminder-start-hint')?.textContent ?? null;
}

// The form defaults its start date to the real today, so these tests run on the real clock.
afterEach(() => cleanup());

describe('the reminder start date says when it is first due', () => {
	test('a new reminder starting today warns it is due as soon as it is saved', () => {
		renderNew();
		expect(hint()).toBe(
			'It’s first due today, then every month, so it’s due as soon as you save. Pick a later date if it isn’t due yet.'
		);
		expect(
			document.getElementById('reminder-start')?.getAttribute('aria-describedby')?.split(' ')
		).toContain('reminder-start-hint');
	});

	test('a later start date reads as the first due date, with the repeat', () => {
		renderNew({
			startDate: '2999-07-01',
			frequency: 'custom',
			intervalValue: '3',
			intervalUnit: 'month'
		});
		expect(hint()).toBe('It’s first due on this date, then every 3 months.');
	});

	test('a recurring expense starting today says the first one is added right away', () => {
		renderNew({ kind: 'expense', frequency: 'yearly' });
		expect(hint()).toBe(
			'The first expense is added today, then every year, so it’s added right away. Pick a later date if the first one isn’t due yet.'
		);
	});

	test('editing an existing reminder shows no first-due hint', () => {
		const form = new ReminderFormState();
		form.load(makeReminderWithVehicles(), [makeVehicle('v1')]);
		render(ScheduleFields, { props: { form } });
		expect(screen.getByText('Start date *')).toBeInTheDocument();
		expect(hint()).toBeNull();
	});
});
