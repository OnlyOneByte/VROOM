/**
 * What the expense form does when a CREATE fails decides whether the user's data survives — and
 * whether what they are told is true.
 *
 * The form's catch used to be unconditional: every failure, including one the server had just
 * decided (a validation rejection, a deleted vehicle, a revoked share), was written to the offline
 * outbox and announced as "Saved offline due to connection issue". That is two defects in one — the
 * message is false, and the queued row is re-POSTed on every sync forever because the same request
 * is rejected identically every time. Nothing ever delivers it and nothing ever tells the user.
 *
 * So the three outcomes below are the contract, driven through the MOUNTED form (clicking the real
 * Save button, with the real offline-storage writing to the real localStorage mock) because the
 * decision only matters where it is wired:
 *   - a 4xx verdict  → shown on the form, nothing queued, no navigation away;
 *   - a 5xx/transport failure → queued for later delivery, user moved on;
 *   - a queue write that FAILS → said out loud, and the user keeps the filled-in form (the project's
 *     offline writes never drop rule — the inverse, a silent drop with a success toast, is the bug).
 */

import { beforeEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import { ApiError } from '$lib/utils/error-handling';
import { loadOfflineExpenses } from '$lib/utils/offline-storage';

/**
 * Mounting needs svelte's CLIENT entry, and this suite resolves the package's `default` (server)
 * one because vite.config.ts sets no `browser` resolve condition for tests — `mount()` from a bare
 * `svelte` import throws "not available on the server". Written `as string` so TypeScript does not
 * try to type svelte's internals (which ship no declarations) while Vite still resolves the path.
 */
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

/** Mount the create form pre-filled with a valid expense, then press Save. */
async function fillAndSave(): Promise<void> {
	render(ExpenseForm, {
		props: {
			preselectedVehicleId: 'v1',
			preselectedCategory: 'other',
			preselectedAmount: '42.50'
		}
	});
	// The preselected values are applied in onMount, AFTER its awaits — clicking before they land
	// would just fail validation. The populated amount field is the signal that the form is ready.
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

		// The server's own reason reaches the user, instead of a connection story.
		await vi.waitFor(() => expect(submitError()).toBe('Amount must be greater than 0'));
		// Nothing was queued: a row the server rejects deterministically can never sync.
		expect(loadOfflineExpenses()).toEqual([]);
		// And the user keeps the form they filled in.
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
		// Site data blocked / quota exhausted: the one localStorage write this submit makes throws.
		localStorageMock.setItem.mockImplementationOnce(() => {
			throw new DOMException('site data is blocked', 'SecurityError');
		});

		await fillAndSave();

		await vi.waitFor(() => expect(submitError()).toMatch(/could not store the expense/i));
		expect(loadOfflineExpenses()).toEqual([]);
		// Navigating away would be the silent data loss: the form is the only remaining copy.
		expect(goto).not.toHaveBeenCalled();
	});
});
