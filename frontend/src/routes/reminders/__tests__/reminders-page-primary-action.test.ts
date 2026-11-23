import { beforeEach, describe, expect, test, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/svelte';
import type { ReminderWithVehicles } from '#lib/types/index.ts';
import { ApiError, SERVER_FAILURE_MESSAGE } from '#lib/utils/error-handling.ts';

vi.mock('#lib/components/reminders/ReminderForm.svelte', () => ({ default: () => {} }));
vi.mock('#lib/components/reminders/MaterializedExpensesDialog.svelte', () => ({
	default: () => {}
}));

const list = vi.fn();
vi.mock('#lib/services/reminder-api.ts', () => ({
	reminderApi: {
		list: (...args: unknown[]) => list(...args),
		getNotifications: () => Promise.resolve([])
	}
}));
const getVehicles = vi.fn();
vi.mock('#lib/services/vehicle-api.ts', () => ({
	vehicleApi: { getVehicles: (...args: unknown[]) => getVehicles(...args) }
}));
vi.mock('$app/paths', () => ({ resolve: (path: string) => path }));

const VEHICLE = { id: 'v1', make: 'Toyota', model: 'Camry', year: 2020 };

import Page from '../+page.svelte';

function reminder(nextDueDate: string): ReminderWithVehicles {
	return {
		reminder: {
			id: `r-${nextDueDate}`,
			name: 'Oil change',
			type: 'notification',
			isActive: true,
			nextDueDate,
			nextDueOdometer: null,
			expenseAmount: null,
			description: null
		},
		vehicleIds: []
	} as unknown as ReminderWithVehicles;
}

function controls(name: string) {
	return [...screen.queryAllByRole('button', { name }), ...screen.queryAllByRole('link', { name })];
}

function belowLg(name: string) {
	return controls(name).filter(control => !control.classList.contains('hidden'));
}

function fromLg(name: string) {
	return controls(name).filter(control => !control.classList.contains('lg:hidden'));
}

beforeEach(() => {
	vi.clearAllMocks();
	getVehicles.mockImplementation(() => Promise.resolve([VEHICLE]));
});

describe('/reminders primary action', () => {
	test('with no vehicles it points to Add Vehicle and offers no New Reminder', async () => {
		list.mockImplementation(() => Promise.resolve([]));
		getVehicles.mockImplementation(() => Promise.resolve([]));
		render(Page);

		await screen.findByRole('heading', { name: 'Add a vehicle first' });
		expect(controls('Add Vehicle')).toHaveLength(1);
		expect(controls('Add Vehicle')[0]).toHaveAttribute('href', '/vehicles/new');
		expect(controls('New Reminder')).toHaveLength(0);
		expect(screen.queryByText('No reminders yet')).toBeNull();
	});

	test('reminders left without vehicles still list, with no New Reminder', async () => {
		list.mockImplementation(() => Promise.resolve([reminder('2999-01-01T00:00:00.000Z')]));
		getVehicles.mockImplementation(() => Promise.resolve([]));
		render(Page);

		await waitFor(() => expect(screen.getByText('Oil change')).toBeInTheDocument());
		expect(controls('New Reminder')).toHaveLength(0);
		expect(screen.queryByRole('heading', { name: 'Add a vehicle first' })).toBeNull();
	});

	test('due reminders left without vehicles offer Add Vehicle above the list and no Run Due Reminders', async () => {
		list.mockImplementation(() => Promise.resolve([reminder('2000-01-01T00:00:00.000Z')]));
		getVehicles.mockImplementation(() => Promise.resolve([]));
		render(Page);

		await waitFor(() => expect(screen.getByText('Oil change')).toBeInTheDocument());
		const prompt = screen.getByTestId('reminders-no-vehicles');
		expect(prompt).toHaveTextContent("can't file expenses until you add one");
		expect(controls('Add Vehicle')).toHaveLength(1);
		expect(controls('Add Vehicle')[0]).toHaveAttribute('href', '/vehicles/new');
		expect(
			prompt.compareDocumentPosition(screen.getByText('Oil change')) &
				Node.DOCUMENT_POSITION_FOLLOWING
		).toBeTruthy();
		expect(controls('Run Due Reminders')).toHaveLength(0);
	});

	test('with vehicles there is no Add Vehicle prompt above the list', async () => {
		list.mockImplementation(() => Promise.resolve([reminder('2000-01-01T00:00:00.000Z')]));
		render(Page);

		await waitFor(() => expect(controls('Run Due Reminders')).toHaveLength(1));
		expect(screen.queryByTestId('reminders-no-vehicles')).toBeNull();
	});

	test('the empty state offers New Reminder once and no Run Due Reminders', async () => {
		list.mockImplementation(() => Promise.resolve([]));
		render(Page);

		await waitFor(() => expect(screen.getByText('No reminders yet')).toBeInTheDocument());
		expect(controls('New Reminder')).toHaveLength(1);
		expect(controls('Run Due Reminders')).toHaveLength(0);
	});

	test('a populated list offers New Reminder once, and Run Due Reminders only when one is due', async () => {
		list.mockImplementation(() => Promise.resolve([reminder('2999-01-01T00:00:00.000Z')]));
		render(Page);

		await waitFor(() => expect(screen.getByText('Oil change')).toBeInTheDocument());
		expect(belowLg('New Reminder')).toHaveLength(1);
		expect(belowLg('New Reminder')[0]).toHaveClass('fixed');
		expect(fromLg('New Reminder')).toHaveLength(1);
		expect(fromLg('New Reminder')[0]).not.toHaveClass('fixed');
		expect(controls('Run Due Reminders')).toHaveLength(0);
	});

	test('a due reminder shows Run Due Reminders', async () => {
		list.mockImplementation(() => Promise.resolve([reminder('2000-01-01T00:00:00.000Z')]));
		render(Page);

		await waitFor(() => expect(controls('Run Due Reminders')).toHaveLength(1));
		expect(belowLg('New Reminder')).toHaveLength(1);
		expect(fromLg('New Reminder')).toHaveLength(1);
	});
});

describe('/reminders load failure', () => {
	test('the error card never shows the server text', async () => {
		list.mockImplementation(() =>
			Promise.reject(new ApiError('Request failed with status 500', 500))
		);
		render(Page);

		await waitFor(() => expect(screen.getByText("Couldn't load reminders")).toBeInTheDocument());
		expect(screen.getByText(SERVER_FAILURE_MESSAGE)).toBeInTheDocument();
		expect(screen.queryByText(/status 500/)).toBeNull();
		expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
	});
});
