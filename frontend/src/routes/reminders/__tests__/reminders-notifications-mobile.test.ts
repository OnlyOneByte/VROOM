import { describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import type { ReminderNotification } from '#lib/types/index.ts';

vi.mock('#lib/components/reminders/ReminderForm.svelte', () => ({ default: () => {} }));
vi.mock('#lib/components/reminders/MaterializedExpensesDialog.svelte', () => ({
	default: () => {}
}));

vi.mock('#lib/services/reminder-api.ts', () => ({
	reminderApi: {
		list: () => Promise.resolve([]),
		getNotifications: () =>
			Promise.resolve([
				{
					id: 'n1',
					reminderId: 'r1',
					dueDate: '2026-11-15T00:00:00.000Z',
					dueOdometer: null,
					isRead: false
				} as unknown as ReminderNotification
			])
	}
}));
vi.mock('#lib/services/vehicle-api.ts', () => ({
	vehicleApi: { getVehicles: () => Promise.resolve([]) }
}));

import Page from '../+page.svelte';

describe('/reminders notifications on mobile', () => {
	test('the header row wraps and Mark all read is a 40px target', async () => {
		render(Page);

		const markAll = await screen.findByRole('button', { name: 'Mark all read' });
		expect(markAll).toHaveClass('h-10');
		expect(markAll.parentElement).toHaveClass('flex-wrap');
	});

	test('each Mark as read icon button is 40px', async () => {
		render(Page);

		const markOne = await screen.findByRole('button', { name: 'Mark as read' });
		expect(markOne).toHaveClass('size-10');
	});
});
