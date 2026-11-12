import { beforeEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import { ApiError } from '$lib/utils/error-handling';
import { loadOfflineExpenses } from '$lib/utils/offline-storage';

const goto = vi.fn(() => Promise.resolve());
vi.mock('$app/navigation', () => ({
	goto,
	beforeNavigate: vi.fn(),
	afterNavigate: vi.fn(),
	invalidateAll: vi.fn()
}));

const VEHICLE = { id: 'v1', make: 'Toyota', model: 'Camry', year: 2020 };
vi.mock('$lib/services/vehicle-api', () => ({
	vehicleApi: {
		getVehicles: vi.fn(() => Promise.resolve([VEHICLE])),
		getVehicle: vi.fn(() => Promise.resolve(VEHICLE))
	}
}));

const createExpense = vi.fn();
vi.mock('$lib/services/expense-api', () => ({
	expenseApi: {
		createExpense,
		getExpensesByVehicle: vi.fn(() => Promise.resolve({ data: [] }))
	}
}));

const ExpenseForm = (await import('../ExpenseForm.svelte')).default;

const localStorageMock = window.localStorage as unknown as {
	clear: () => void;
	setItem: { mockImplementationOnce: (fn: () => void) => void };
};

async function fillAndSave(): Promise<void> {
	render(ExpenseForm, {
		props: {
			preselectedVehicleId: 'v1',
			preselectedCategory: 'other',
			preselectedAmount: '42.50'
		}
	});
	await vi.waitFor(() => expect(screen.getByDisplayValue('42.50')).toBeTruthy());
	await fireEvent.click(screen.getByRole('button', { name: /save expense/i }));
	await vi.waitFor(() => expect(createExpense).toHaveBeenCalled());
}

function submitError(): string | null {
	return document.querySelector('[data-testid="submit-error"]')?.textContent?.trim() ?? null;
}

describe('ExpenseForm — a failed create is classified before anything is queued', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		localStorageMock.clear();
	});

	test('a 400 is shown on the form and queues NOTHING', async () => {
		createExpense.mockRejectedValue(new ApiError('Amount must be greater than 0', 400));

		await fillAndSave();

		await vi.waitFor(() => expect(submitError()).toBe('Amount must be greater than 0'));
		expect(loadOfflineExpenses()).toEqual([]);
		expect(goto).not.toHaveBeenCalled();
	});

	test('a 404 (vehicle deleted elsewhere) is shown on the form and queues NOTHING', async () => {
		createExpense.mockRejectedValue(new ApiError('Vehicle not found', 404));

		await fillAndSave();

		await vi.waitFor(() => expect(submitError()).toBe('Vehicle not found'));
		expect(loadOfflineExpenses()).toEqual([]);
		expect(goto).not.toHaveBeenCalled();
	});

	test('a 503 IS queued for later delivery and the user moves on', async () => {
		createExpense.mockRejectedValue(new ApiError('Service Unavailable', 503));

		await fillAndSave();

		await vi.waitFor(() => expect(loadOfflineExpenses()).toHaveLength(1));
		const [queued] = loadOfflineExpenses();
		expect(queued?.amount).toBe(42.5);
		expect(queued?.vehicleId).toBe('v1');
		expect(submitError()).toBeNull();
		await vi.waitFor(() => expect(goto).toHaveBeenCalled());
	});

	test('a queue write that fails is reported, not announced as saved', async () => {
		createExpense.mockRejectedValue(new ApiError('Service Unavailable', 503));
		localStorageMock.setItem.mockImplementationOnce(() => {
			throw new DOMException('site data is blocked', 'SecurityError');
		});

		await fillAndSave();

		await vi.waitFor(() => expect(submitError()).toMatch(/could not store the expense/i));
		expect(loadOfflineExpenses()).toEqual([]);
		expect(goto).not.toHaveBeenCalled();
	});
});
