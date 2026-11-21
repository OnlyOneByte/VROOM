import { beforeEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import type { ReminderWithVehicles } from '#lib/types/index.ts';

vi.mock('#lib/components/reminders/ReminderForm.svelte', () => ({ default: () => {} }));
vi.mock('#lib/components/reminders/MaterializedExpensesDialog.svelte', () => ({
	default: () => {}
}));

const { list, update, addNotification } = vi.hoisted(() => ({
	list: vi.fn(),
	update: vi.fn(),
	addNotification: vi.fn()
}));
vi.mock('#lib/services/reminder-api.ts', () => ({
	reminderApi: {
		list: (...args: unknown[]) => list(...args),
		getNotifications: () => Promise.resolve([]),
		update: (...args: unknown[]) => update(...args)
	}
}));
vi.mock('#lib/services/vehicle-api.ts', () => ({
	vehicleApi: { getVehicles: () => Promise.resolve([]) }
}));
vi.mock('#lib/stores/app.svelte.ts', () => ({ appStore: { addNotification } }));

import Page from '../+page.svelte';

const dueReminder = {
	reminder: {
		id: 'r1',
		name: 'Oil change',
		type: 'notification',
		isActive: true,
		triggerMode: 'time',
		frequency: 'monthly',
		nextDueDate: '2000-01-01T00:00:00.000Z',
		nextDueOdometer: null,
		expenseAmount: null,
		description: null
	},
	vehicleIds: []
} as unknown as ReminderWithVehicles;

beforeEach(() => {
	vi.clearAllMocks();
});

describe('/reminders error copy', () => {
	test('the load-error card title is in Title Case', async () => {
		list.mockImplementation(() => Promise.reject(new Error('offline')));
		render(Page);

		await waitFor(() => expect(screen.getByText('Failed to Load Reminders')).toBeInTheDocument());
		expect(addNotification).toHaveBeenCalledWith({
			type: 'error',
			message: 'Failed to load reminders. Please try again.'
		});
	});

	test('a failed action toast tells the user to try again', async () => {
		list.mockImplementation(() => Promise.resolve([dueReminder]));
		update.mockImplementation(() => Promise.reject(new Error('boom')));
		render(Page);

		await fireEvent.click(await screen.findByRole('button', { name: 'Pause' }));

		await waitFor(() =>
			expect(addNotification).toHaveBeenCalledWith({
				type: 'error',
				message: 'Failed to update reminder. Please try again.'
			})
		);
	});
});
