import { beforeEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import type { ReminderWithVehicles } from '#lib/types/index.ts';

let formProps: { onSaved: () => Promise<void> | void } | null = null;
vi.mock('#lib/components/reminders/ReminderForm.svelte', () => ({
	default: (_anchor: unknown, props: { onSaved: () => Promise<void> | void }) => {
		formProps = props;
	}
}));
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

const SAVED = {
	reminder: {
		id: 'r1',
		name: 'Oil change',
		type: 'notification',
		isActive: true,
		nextDueDate: '2999-01-01T00:00:00.000Z',
		nextDueOdometer: null,
		expenseAmount: null,
		description: null
	},
	vehicleIds: ['v1']
} as unknown as ReminderWithVehicles;

beforeEach(() => {
	vi.clearAllMocks();
	formProps = null;
});

describe('/reminders after saving', () => {
	test('creating the first reminder puts focus on New reminder, with no loading flash', async () => {
		list.mockResolvedValueOnce([]);
		render(Page);
		const emptyAction = await screen.findByRole('button', { name: 'New reminder' });
		await fireEvent.click(emptyAction);

		list.mockResolvedValueOnce([SAVED]);
		const saving = formProps?.onSaved();
		expect(document.querySelector('[data-slot="skeleton"]')).toBeNull();
		await saving;

		await waitFor(() => expect(screen.getByText('Oil change')).toBeInTheDocument());
		const header = screen.getByRole('button', { name: 'New reminder' });
		expect(document.activeElement).toBe(header);
	});
});
