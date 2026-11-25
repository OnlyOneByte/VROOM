import { beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { hasPendingSave } from '#lib/utils/pending-saves.ts';
import { ApiError } from '#lib/utils/error-handling.ts';
import { loadOfflineExpenses } from '#lib/utils/offline-storage.ts';

const goto = vi.fn(() => Promise.resolve());
vi.mock('$app/navigation', () => ({
	goto,
	beforeNavigate: vi.fn(),
	afterNavigate: vi.fn(),
	refreshAll: vi.fn()
}));

const VEHICLES = [
	{ id: 'v1', make: 'Toyota', model: 'Camry', year: 2020 },
	{ id: 'v2', make: 'Honda', model: 'Civic', year: 2021 }
];
vi.mock('#lib/services/vehicle-api.ts', () => ({
	vehicleApi: {
		getVehicles: vi.fn(() => Promise.resolve(VEHICLES)),
		getVehicle: vi.fn((id: string) => Promise.resolve(VEHICLES.find(v => v.id === id)))
	}
}));

const createExpense = vi.fn();
const createSplitExpense = vi.fn();
vi.mock('#lib/services/expense-api.ts', () => ({
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
		await vi.waitFor(() =>
			expect(submitError()).toBe(
				"Couldn't save this expense. Something went wrong on our side. Try again in a moment."
			)
		);
		expect(loadOfflineExpenses()).toEqual([]);
		expect(createExpense).not.toHaveBeenCalled();
		expect(goto).not.toHaveBeenCalled();
	});

	test('a split save in flight counts as unsaved changes; a single save, which can be queued, does not', async () => {
		createSplitExpense.mockReturnValue(new Promise(() => {}));
		createExpense.mockReturnValue(new Promise(() => {}));
		render(ExpenseForm, {
			props: { preselectedVehicleId: 'v1', preselectedCategory: 'misc', preselectedAmount: '100' }
		});
		await vi.waitFor(() => expect(screen.getByDisplayValue('100')).toBeTruthy());

		await fireEvent.click(screen.getByRole('button', { name: /save expense/i }));
		await vi.waitFor(() => expect(loadOfflineExpenses()).toHaveLength(1));
		expect(hasPendingSave()).toBe(false);
		cleanup();

		render(ExpenseForm, {
			props: { preselectedVehicleId: 'v1', preselectedCategory: 'misc', preselectedAmount: '100' }
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
		expect(hasPendingSave()).toBe(true);
		cleanup();
		expect(hasPendingSave()).toBe(false);
	});
});
