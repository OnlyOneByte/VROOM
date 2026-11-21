import { beforeEach, describe, expect, test, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/svelte';
import type { ReminderWithVehicles } from '#lib/types/index.ts';

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
vi.mock('#lib/services/vehicle-api.ts', () => ({
	vehicleApi: { getVehicles: () => Promise.resolve([]) }
}));

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
});

describe('/reminders primary action', () => {
	test('the empty state offers New Reminder once and no Run due reminders', async () => {
		list.mockImplementation(() => Promise.resolve([]));
		render(Page);

		await waitFor(() => expect(screen.getByText('No reminders yet')).toBeInTheDocument());
		expect(controls('New Reminder')).toHaveLength(1);
		expect(controls('Run due reminders')).toHaveLength(0);
	});

	test('a populated list offers New Reminder once, and Run due reminders only when one is due', async () => {
		list.mockImplementation(() => Promise.resolve([reminder('2999-01-01T00:00:00.000Z')]));
		render(Page);

		await waitFor(() => expect(screen.getByText('Oil change')).toBeInTheDocument());
		expect(controls('New Reminder')).toHaveLength(1);
		expect(controls('New Reminder')[0]).toHaveClass('fixed');
		expect(controls('Run due reminders')).toHaveLength(0);
	});

	test('a due reminder shows Run due reminders', async () => {
		list.mockImplementation(() => Promise.resolve([reminder('2000-01-01T00:00:00.000Z')]));
		render(Page);

		await waitFor(() => expect(controls('Run due reminders')).toHaveLength(1));
		expect(controls('New Reminder')).toHaveLength(1);
	});
});

describe('/reminders load failure', () => {
	test('the error card never shows the server text', async () => {
		list.mockImplementation(() => Promise.reject(new Error('Request failed with status 500')));
		render(Page);

		await waitFor(() =>
			expect(screen.getByText('Check your connection, then select Retry.')).toBeInTheDocument()
		);
		expect(screen.queryByText(/status 500/)).toBeNull();
		expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
	});
});
