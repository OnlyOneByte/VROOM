import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/svelte';
import {
	makeReminderWithVehicles,
	makeVehicle
} from '../reminder-form/__tests__/reminder-form-fixtures.ts';

vi.mock('#lib/services/reminder-api.ts', () => ({
	reminderApi: { create: vi.fn(), update: vi.fn() }
}));

const ReminderForm = (await import('../ReminderForm.svelte')).default;

afterEach(() => cleanup());

function open(reminder: ReturnType<typeof makeReminderWithVehicles> | null) {
	render(ReminderForm, {
		props: { open: true, reminder, vehicles: [makeVehicle('v1')], onSaved: vi.fn() }
	});
}

describe('ReminderForm dialog copy', () => {
	test('a new reminder says what a reminder can do', async () => {
		open(null);
		const dialog = await screen.findByRole('dialog', { name: 'New reminder' });
		expect(dialog).toHaveAccessibleDescription(
			'Remind yourself about maintenance and renewals, or have a recurring cost added for you.'
		);
	});

	test('editing says it changes this reminder, not that it only notifies', async () => {
		open(makeReminderWithVehicles());
		const dialog = await screen.findByRole('dialog', { name: 'Edit reminder' });
		expect(dialog).toHaveAccessibleDescription('Change what this reminder does and when it’s due.');
		expect(dialog.textContent).not.toContain('Get notified');
	});
});
