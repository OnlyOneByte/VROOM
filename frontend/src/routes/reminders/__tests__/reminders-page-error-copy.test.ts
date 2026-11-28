import { beforeEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import type { ReminderNotification, ReminderWithVehicles } from '#lib/types/index.ts';
import { ApiError, SERVER_FAILURE_MESSAGE } from '#lib/utils/error-handling.ts';

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
const { addNotification, showError } = vi.hoisted(() => ({
	addNotification: vi.fn(),
	showError: vi.fn()
}));

vi.mock('#lib/services/reminder-api.ts', () => ({ reminderApi: api }));
vi.mock('#lib/services/vehicle-api.ts', () => ({
	vehicleApi: {
		getVehicles: () => Promise.resolve([{ id: 'v1', make: 'Toyota', model: 'Camry', year: 2020 }])
	}
}));
vi.mock('#lib/stores/app.svelte.ts', () => ({ appStore: { addNotification, showError } }));

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

const failure = () => Promise.reject(new ApiError('boom', 500));

function expectToast(action: string) {
	return waitFor(() =>
		expect(showError).toHaveBeenCalledWith(`${action} ${SERVER_FAILURE_MESSAGE}`)
	);
}

beforeEach(() => {
	vi.clearAllMocks();
	api.list.mockResolvedValue([reminder()]);
	api.getNotifications.mockResolvedValue([]);
});

describe('/reminders error copy', () => {
	test('the load-error card says what failed and why, without the server text', async () => {
		api.list.mockImplementation(failure);
		render(Page);

		await waitFor(() => expect(screen.getByText("Couldn't load reminders")).toBeInTheDocument());
		expect(screen.getByText(SERVER_FAILURE_MESSAGE)).toBeInTheDocument();
		expect(screen.queryByText(/boom/)).toBeNull();
	});

	test('a failed Run due reminders says what failed and why', async () => {
		api.trigger.mockImplementation(failure);
		render(Page);

		await fireEvent.click(await screen.findByRole('button', { name: 'Run due reminders' }));
		await expectToast("Couldn't run the due reminders.");
	});

	test('a failed Mark as read says what failed and why', async () => {
		api.getNotifications.mockResolvedValue([notification('n1')]);
		api.markNotificationRead.mockImplementation(failure);
		render(Page);

		await fireEvent.click(await screen.findByRole('button', { name: 'Mark as read' }));
		await expectToast("Couldn't mark the notification as read.");
	});

	test('a failed Mark all read says what failed and why', async () => {
		api.getNotifications.mockResolvedValue([notification('n1'), notification('n2')]);
		api.markNotificationRead.mockImplementation(failure);
		render(Page);

		await fireEvent.click(await screen.findByRole('button', { name: 'Mark all read' }));
		await expectToast("Couldn't mark the notifications as read.");
	});

	test('a failed Pause says what failed and why', async () => {
		api.update.mockImplementation(failure);
		render(Page);

		await fireEvent.click(
			await screen.findByRole('button', { name: 'More actions for Oil change' })
		);
		await fireEvent.click(await screen.findByRole('button', { name: 'Pause' }));
		await expectToast("Couldn't pause the reminder.");
	});

	test('a failed Mark Serviced says what failed and why', async () => {
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

		await fireEvent.click(await screen.findByRole('button', { name: 'Mark serviced' }));
		await expectToast("Couldn't mark the reminder as serviced.");
	});

	test('a failed delete says what failed and why', async () => {
		api.delete.mockImplementation(failure);
		render(Page);

		await fireEvent.click(
			await screen.findByRole('button', { name: 'More actions for Oil change' })
		);
		await fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));
		const dialog = await screen.findByRole('alertdialog');
		await fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
		await expectToast("Couldn't delete the reminder.");
	});
});
