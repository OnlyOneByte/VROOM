import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/svelte';

const { reminderApi } = vi.hoisted(() => ({
	reminderApi: { getMaterializedExpenses: vi.fn<(id: string) => Promise<unknown[]>>() }
}));

vi.mock('#lib/services/reminder-api.ts', () => ({ reminderApi }));

const Dialog = (await import('../MaterializedExpensesDialog.svelte')).default;

afterEach(() => cleanup());

describe('MaterializedExpensesDialog load failure', () => {
	test('shows a plain sentence, never the server text', async () => {
		reminderApi.getMaterializedExpenses.mockRejectedValue(
			new Error('Request failed with status 500')
		);
		render(Dialog, {
			open: true,
			reminderId: 'r1',
			reminderName: 'Insurance',
			vehicleNames: new Map()
		});
		expect(
			await screen.findByText('Couldn’t load the expenses this reminder created. Please try again.')
		).toBeInTheDocument();
		expect(screen.queryByText(/status 500/)).toBeNull();
	});
});
