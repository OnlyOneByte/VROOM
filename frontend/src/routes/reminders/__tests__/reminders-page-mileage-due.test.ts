import { beforeEach, describe, expect, test, vi } from 'vitest';
import { render, screen, within } from '@testing-library/svelte';
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
	vehicleApi: {
		getVehicles: () => Promise.resolve([{ id: 'v1', make: 'Toyota', model: 'Camry', year: 2020 }])
	}
}));
vi.mock('$app/paths', () => ({ resolve: (path: string) => path }));

import Page from '../+page.svelte';

function mileageReminder(id: string, name: string, mileageDue: boolean): ReminderWithVehicles {
	return {
		reminder: {
			id,
			name,
			type: 'notification',
			isActive: true,
			triggerMode: 'mileage',
			frequency: 'custom',
			intervalMileage: 5000,
			nextDueDate: null,
			nextDueOdometer: 45000,
			expenseAmount: null,
			description: null
		},
		vehicleIds: ['v1'],
		mileageDue
	} as unknown as ReminderWithVehicles;
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe('/reminders mileage reminders', () => {
	test('one whose milestone is reached is listed under Due now', async () => {
		list.mockImplementation(() =>
			Promise.resolve([
				mileageReminder('r-reached', 'Oil change', true),
				mileageReminder('r-ahead', 'Tyre rotation', false)
			])
		);
		render(Page);

		const due = await screen.findByTestId('reminders-due');
		expect(within(due).getByText('Oil change')).toBeInTheDocument();
		expect(
			within(screen.getByTestId('reminders-upcoming')).getByText('Tyre rotation')
		).toBeInTheDocument();
	});
});
