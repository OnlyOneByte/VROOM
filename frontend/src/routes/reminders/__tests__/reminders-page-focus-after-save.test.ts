import { beforeEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import type { ReminderWithVehicles } from '#lib/types/index.ts';
import { ApiError } from '#lib/utils/error-handling.ts';

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

const settle = async () => {
	for (let i = 0; i < 10; i++) await new Promise(resolve => setTimeout(resolve, 0));
};

beforeEach(() => {
	vi.clearAllMocks();
	formProps = null;
});

describe('/reminders after saving', () => {
	test('creating the first reminder refreshes in place and puts focus on New reminder', async () => {
		list.mockResolvedValueOnce([]);
		render(Page);
		await fireEvent.click(await screen.findByRole('button', { name: 'New reminder' }));

		let release: (value: ReminderWithVehicles[]) => void = () => {};
		list.mockReturnValueOnce(new Promise(resolve => (release = resolve)));
		const saving = formProps?.onSaved();
		await settle();
		expect(document.querySelector('[data-slot="skeleton"]')).toBeNull();
		expect(screen.getByText('No reminders yet')).toBeInTheDocument();

		release([SAVED]);
		await saving;
		await waitFor(() => expect(screen.getByText('Oil change')).toBeInTheDocument());
		expect(document.activeElement).toBe(screen.getByRole('button', { name: 'New reminder' }));
	});

	test('a save leaves focus alone when it is already somewhere else on the page', async () => {
		list.mockResolvedValue([SAVED]);
		render(Page);
		await fireEvent.click(await screen.findByRole('button', { name: 'New reminder' }));
		const elsewhere = screen
			.getAllByRole('button')
			.find(b => b.textContent?.trim() !== 'New reminder');
		elsewhere?.focus();

		await formProps?.onSaved();
		await settle();
		expect(document.activeElement).toBe(elsewhere);
	});

	test('if the refresh fails, the page shows its load error', async () => {
		list.mockResolvedValueOnce([]);
		render(Page);
		await fireEvent.click(await screen.findByRole('button', { name: 'New reminder' }));

		list.mockRejectedValue(new ApiError('down', 503));
		await formProps?.onSaved();
		await waitFor(() => expect(screen.getByText("Couldn't load reminders")).toBeInTheDocument());
	});
});
