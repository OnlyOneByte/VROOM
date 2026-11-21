import { beforeEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import type { ReminderNotification, ReminderWithVehicles } from '#lib/types/index.ts';

vi.mock('#lib/components/reminders/ReminderForm.svelte', () => ({ default: () => {} }));
vi.mock('#lib/components/reminders/MaterializedExpensesDialog.svelte', () => ({
	default: () => {}
}));

const api = vi.hoisted(() => ({
	list: vi.fn(),
	getNotifications: vi.fn(),
	trigger: vi.fn(),
	markNotificationRead: vi.fn(),
	update: vi.fn(),
	markServiced: vi.fn(),
	delete: vi.fn()
}));
const { addNotification } = vi.hoisted(() => ({ addNotification: vi.fn() }));

vi.mock('#lib/services/reminder-api.ts', () => ({ reminderApi: api }));
vi.mock('#lib/services/vehicle-api.ts', () => ({
	vehicleApi: { getVehicles: () => Promise.resolve([]) }
}));
vi.mock('#lib/stores/app.svelte.ts', () => ({ appStore: { addNotification } }));

import Page from '../+page.svelte';

function reminder(overrides: Record<string, unknown> = {}): ReminderWithVehicles {
	return {
		reminder: {
			id: 'r1',
			name: 'Oil change',
			type: 'notification',
			isActive: true,
			triggerMode: 'time',
			frequency: 'monthly',
			nextDueDate: '2000-01-01T00:00:00.000Z',
			nextDueOdometer: null,
			intervalMileage: null,
			expenseAmount: null,
			description: null,
			...overrides
		},
		vehicleIds: []
	} as unknown as ReminderWithVehicles;
}

function notification(id: string): ReminderNotification {
	return {
		id,
		reminderId: 'r1',
		dueDate: '2026-11-15T00:00:00.000Z',
		dueOdometer: null,
		isRead: false
	} as unknown as ReminderNotification;
}

const failure = () => Promise.reject(new Error('Request failed with status 500'));

function expectToast(message: string) {
	return waitFor(() => expect(addNotification).toHaveBeenCalledWith({ type: 'error', message }));
}

beforeEach(() => {
	vi.clearAllMocks();
	api.list.mockResolvedValue([reminder()]);
	api.getNotifications.mockResolvedValue([]);
});

describe('/reminders error copy', () => {
	test('the load-error card title is in Title Case', async () => {
		api.list.mockImplementation(failure);
		render(Page);

		await waitFor(() => expect(screen.getByText('Failed to Load Reminders')).toBeInTheDocument());
		await expectToast('Failed to load reminders. Please try again.');
	});

	test('a failed Run Due Reminders tells the user to try again', async () => {
		api.trigger.mockImplementation(failure);
		render(Page);

		await fireEvent.click(await screen.findByRole('button', { name: 'Run Due Reminders' }));
		await expectToast('Failed to run due reminders. Please try again.');
	});

	test('a failed Mark as read tells the user to try again', async () => {
		api.getNotifications.mockResolvedValue([notification('n1')]);
		api.markNotificationRead.mockImplementation(failure);
		render(Page);

		await fireEvent.click(await screen.findByRole('button', { name: 'Mark as read' }));
		await expectToast('Failed to mark as read. Please try again.');
	});

	test('a failed Mark All Read tells the user to try again', async () => {
		api.getNotifications.mockResolvedValue([notification('n1'), notification('n2')]);
		api.markNotificationRead.mockImplementation(failure);
		render(Page);

		await fireEvent.click(await screen.findByRole('button', { name: 'Mark All Read' }));
		await expectToast('Failed to mark all as read. Please try again.');
	});

	test('a failed Pause tells the user to try again', async () => {
		api.update.mockImplementation(failure);
		render(Page);

		await fireEvent.click(await screen.findByRole('button', { name: 'Pause' }));
		await expectToast('Failed to update reminder. Please try again.');
	});

	test('a failed Mark Serviced tells the user to try again', async () => {
		api.list.mockResolvedValue([
			reminder({
				triggerMode: 'mileage',
				nextDueDate: null,
				nextDueOdometer: 40000,
				intervalMileage: 5000
			})
		]);
		api.markServiced.mockImplementation(failure);
		render(Page);

		await fireEvent.click(await screen.findByRole('button', { name: 'Mark Serviced' }));
		await expectToast('Failed to mark serviced. Please try again.');
	});

	test('a failed delete tells the user to try again', async () => {
		api.delete.mockImplementation(failure);
		render(Page);

		await fireEvent.click(await screen.findByRole('button', { name: 'Delete reminder' }));
		const dialog = await screen.findByRole('alertdialog');
		await fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
		await expectToast('Failed to delete reminder. Please try again.');
	});
});
