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

beforeEach(() => {
	vi.clearAllMocks();
	getVehicles.mockImplementation(() => Promise.resolve([VEHICLE]));
});

describe('/reminders primary action', () => {
	test('with no vehicles it points to Add vehicle and offers no New reminder', async () => {
		list.mockImplementation(() => Promise.resolve([]));
		getVehicles.mockImplementation(() => Promise.resolve([]));
		render(Page);

		await screen.findByRole('heading', { name: 'Add a vehicle first' });
		expect(controls('Add vehicle')).toHaveLength(1);
		expect(controls('Add vehicle')[0]).toHaveAttribute('href', '/vehicles/new');
		expect(controls('New reminder')).toHaveLength(0);
		expect(screen.queryByText('No reminders yet')).toBeNull();
	});

	test('reminders left without vehicles still list, with no New reminder', async () => {
		list.mockImplementation(() => Promise.resolve([reminder('2999-01-01T00:00:00.000Z')]));
		getVehicles.mockImplementation(() => Promise.resolve([]));
		render(Page);

		await waitFor(() => expect(screen.getByText('Oil change')).toBeInTheDocument());
		expect(controls('New reminder')).toHaveLength(0);
		expect(screen.queryByRole('heading', { name: 'Add a vehicle first' })).toBeNull();
	});

	test('due reminders left without vehicles offer Add vehicle above the list and no Run due reminders', async () => {
		list.mockImplementation(() => Promise.resolve([reminder('2000-01-01T00:00:00.000Z')]));
		getVehicles.mockImplementation(() => Promise.resolve([]));
		render(Page);

		await waitFor(() => expect(screen.getByText('Oil change')).toBeInTheDocument());
		const prompt = screen.getByTestId('reminders-no-vehicles');
		expect(prompt).toHaveAttribute('role', 'status');
		expect(prompt).toHaveTextContent('This reminder lost its vehicle');
		expect(controls('Add vehicle')).toHaveLength(1);
		expect(controls('Add vehicle')[0]).toHaveAttribute('href', '/vehicles/new');
		expect(
			prompt.compareDocumentPosition(screen.getByText('Oil change')) &
				Node.DOCUMENT_POSITION_FOLLOWING
		).toBeTruthy();
		expect(controls('Run due reminders')).toHaveLength(0);
	});

	test('a paused reminder that lost its vehicle offers no Resume, which the server would reject', async () => {
		const orphan = reminder('2999-01-01T00:00:00.000Z');
		orphan.reminder.isActive = false;
		const kept = { ...reminder('2998-01-01T00:00:00.000Z'), vehicleIds: ['v1'] };
		kept.reminder = { ...kept.reminder, id: 'r-kept', name: 'Tyre swap', isActive: false };
		list.mockImplementation(() => Promise.resolve([orphan, kept]));
		render(Page);

		await waitFor(() => expect(screen.getByText('Tyre swap')).toBeInTheDocument());
		expect(controls('Resume')).toHaveLength(1);
		expect(screen.getAllByText('No vehicle. Edit to choose one, then resume.')).toHaveLength(1);
		expect(screen.getByTestId('reminder-card-r-kept').contains(controls('Resume')[0] ?? null)).toBe(
			true
		);
	});

	test('with vehicles there is no Add vehicle prompt above the list', async () => {
		list.mockImplementation(() => Promise.resolve([reminder('2000-01-01T00:00:00.000Z')]));
		render(Page);

		await waitFor(() => expect(controls('Run due reminders')).toHaveLength(1));
		expect(screen.queryByTestId('reminders-no-vehicles')).toBeNull();
	});

	test('the empty state offers New reminder once and no Run due reminders', async () => {
		list.mockImplementation(() => Promise.resolve([]));
		render(Page);

		await waitFor(() => expect(screen.getByText('No reminders yet')).toBeInTheDocument());
		expect(controls('New reminder')).toHaveLength(1);
		expect(controls('Run due reminders')).toHaveLength(0);
	});

	test('a populated list offers New reminder once, and Run due reminders only when one is due', async () => {
		list.mockImplementation(() => Promise.resolve([reminder('2999-01-01T00:00:00.000Z')]));
		render(Page);

		await waitFor(() => expect(screen.getByText('Oil change')).toBeInTheDocument());
		expect(controls('New reminder')).toHaveLength(1);
		expect(controls('New reminder')[0]).not.toHaveClass('fixed', 'hidden');
		expect(controls('Run due reminders')).toHaveLength(0);
	});

	test('a due reminder shows Run due reminders', async () => {
		list.mockImplementation(() => Promise.resolve([reminder('2000-01-01T00:00:00.000Z')]));
		render(Page);

		await waitFor(() => expect(controls('Run due reminders')).toHaveLength(1));
		expect(controls('New reminder')).toHaveLength(1);
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
