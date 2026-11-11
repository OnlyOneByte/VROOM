// A split create that fails transiently must stay on the form: the offline outbox only holds single
// expenses, so queueing it would record the full total against one vehicle.

import { beforeEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import { ApiError } from '$lib/utils/error-handling';
import { loadOfflineExpenses } from '$lib/utils/offline-storage';

// Mounting needs svelte's client entry, which the default test resolution does not provide.
vi.mock(
	'svelte',
	() => import('../../../../../../node_modules/svelte/src/index-client.js' as string)
);

const goto = vi.fn(() => Promise.resolve());
vi.mock('$app/navigation', () => ({
	goto,
	beforeNavigate: vi.fn(),
	afterNavigate: vi.fn(),
	invalidateAll: vi.fn()
}));

const VEHICLES = [
	{ id: 'v1', make: 'Toyota', model: 'Camry', year: 2020 },
	{ id: 'v2', make: 'Honda', model: 'Civic', year: 2021 }
];
vi.mock('$lib/services/vehicle-api', () => ({
	vehicleApi: {
		getVehicles: vi.fn(() => Promise.resolve(VEHICLES)),
		getVehicle: vi.fn((id: string) => Promise.resolve(VEHICLES.find(v => v.id === id)))
	}
}));

const createExpense = vi.fn();
const createSplitExpense = vi.fn();
vi.mock('$lib/services/expense-api', () => ({
	expenseApi: {
		createExpense,
		createSplitExpense,
		getExpensesByVehicle: vi.fn(() => Promise.resolve({ data: [] }))
	}
}));

const ExpenseForm = (await import('../ExpenseForm.svelte')).default;

const localStorageMock = window.localStorage as unknown as { clear: () => void };

function submitError(): string | null {
	return document.querySelector('[data-testid="submit-error"]')?.textContent?.trim() ?? null;
}

describe('ExpenseForm — a failed split create is never queued', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		localStorageMock.clear();
	});

	test('a 503 on a two-vehicle split stays on the form and queues nothing', async () => {
		createSplitExpense.mockRejectedValue(new ApiError('Service Unavailable', 503));
		render(ExpenseForm, {
			props: {
				preselectedVehicleId: 'v1',
				preselectedCategory: 'misc',
				preselectedAmount: '100'
			}
		});
		await vi.waitFor(() => expect(screen.getByDisplayValue('100')).toBeTruthy());

		await fireEvent.click(screen.getByRole('button', { name: /split cost across vehicles/i }));
		const unchecked = await vi.waitFor(() => {
			const box = screen
				.getAllByRole('checkbox')
				.find(el => el.getAttribute('aria-checked') === 'false');
			expect(box).toBeTruthy();
			return box!;
		});
		await fireEvent.click(unchecked);
		await fireEvent.click(screen.getByRole('button', { name: /save expense/i }));

		await vi.waitFor(() => expect(createSplitExpense).toHaveBeenCalled());
		await vi.waitFor(() => expect(submitError()).toBe('Network error. Please try again.'));
		expect(loadOfflineExpenses()).toEqual([]);
		expect(createExpense).not.toHaveBeenCalled();
		expect(goto).not.toHaveBeenCalled();
	});
});
