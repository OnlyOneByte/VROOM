import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { Expense } from '#lib/types/index.ts';

const appStore = vi.hoisted(() => ({ addNotification: vi.fn(), dismissToast: vi.fn() }));
vi.mock('#lib/stores/app.svelte.ts', () => ({ appStore }));
vi.mock('$app/paths', () => ({ resolve: (path: string) => path }));
vi.mock('#lib/services/expense-api.ts', () => ({
	expenseApi: { deleteExpense: vi.fn(), deleteSplitExpense: vi.fn() }
}));

import { expenseApi } from '#lib/services/expense-api.ts';
import { ApiError } from '#lib/utils/error-handling.ts';
import {
	UNDO_WINDOW_MS,
	deleteFailureStates,
	isDeleteHidden,
	resetPendingDeletes,
	retryDelete,
	scheduleDelete
} from '../pending-deletes.svelte.ts';

const expense = (over: Partial<Expense> = {}) =>
	({
		id: 'e1',
		vehicleId: 'v1',
		tags: [],
		category: 'fuel',
		amount: 40,
		date: '2026-11-20T12:00:00.000Z',
		...over
	}) as Expense;

function lastAction(): { label: string; onClick: () => void } {
	const call = appStore.addNotification.mock.calls.at(-1) as [{ action: never }];
	return call[0].action;
}

describe('deleting an expense waits 5 s for Undo', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.clearAllMocks();
		vi.mocked(expenseApi.deleteExpense).mockResolvedValue(undefined);
	});
	afterEach(() => {
		resetPendingDeletes();
		vi.useRealTimers();
	});

	test('the row hides at once, and Undo brings it back without sending a DELETE', async () => {
		scheduleDelete(expense());
		expect(isDeleteHidden(expense())).toBe(true);
		expect(appStore.addNotification).toHaveBeenCalledTimes(1);
		expect(lastAction().label).toBe('Undo');

		lastAction().onClick();
		expect(isDeleteHidden(expense())).toBe(false);
		await vi.advanceTimersByTimeAsync(UNDO_WINDOW_MS + 100);
		expect(expenseApi.deleteExpense).not.toHaveBeenCalled();
		expect(appStore.addNotification).toHaveBeenCalledTimes(1);
	});

	test('the DELETE goes out only once the window ends, then the list refreshes and the row stays gone', async () => {
		const refresh = vi.fn();
		scheduleDelete(expense(), refresh);
		await vi.advanceTimersByTimeAsync(UNDO_WINDOW_MS - 100);
		expect(expenseApi.deleteExpense).not.toHaveBeenCalled();

		await vi.advanceTimersByTimeAsync(200);
		expect(expenseApi.deleteExpense).toHaveBeenCalledWith('e1');
		expect(refresh).toHaveBeenCalledTimes(1);
		expect(isDeleteHidden(expense())).toBe(true);
		expect(appStore.addNotification).toHaveBeenCalledTimes(1);
	});

	test('the Undo toast is taken down when the DELETE goes out, even if it was held open', async () => {
		scheduleDelete(expense());
		await vi.advanceTimersByTimeAsync(UNDO_WINDOW_MS);
		expect(appStore.dismissToast).toHaveBeenCalledWith('expense-delete-e1');
		lastAction().onClick();
		expect(isDeleteHidden(expense())).toBe(true);
	});

	test('deleting again after a failure starts a new Undo window', async () => {
		vi.mocked(expenseApi.deleteExpense).mockRejectedValueOnce(new ApiError('down', 500));
		scheduleDelete(expense());
		await vi.advanceTimersByTimeAsync(UNDO_WINDOW_MS);
		expect(isDeleteHidden(expense())).toBe(false);

		scheduleDelete(expense());
		expect(isDeleteHidden(expense())).toBe(true);
		expect(lastAction().label).toBe('Undo');
		await vi.advanceTimersByTimeAsync(UNDO_WINDOW_MS);
		expect(expenseApi.deleteExpense).toHaveBeenCalledTimes(2);
	});

	test('a split hides every vehicle portion and is deleted as one group', async () => {
		scheduleDelete(expense({ id: 'a', groupId: 'g' }));
		expect(isDeleteHidden(expense({ id: 'b', groupId: 'g' }))).toBe(true);
		await vi.advanceTimersByTimeAsync(UNDO_WINDOW_MS);
		expect(expenseApi.deleteSplitExpense).toHaveBeenCalledWith('g');
	});

	test('a failed DELETE brings the row back with its error and one Retry toast, and Retry sends again', async () => {
		vi.mocked(expenseApi.deleteExpense).mockRejectedValueOnce(new ApiError('SQLITE_BUSY', 500));
		const refresh = vi.fn();
		scheduleDelete(expense(), refresh);
		await vi.advanceTimersByTimeAsync(UNDO_WINDOW_MS);

		expect(isDeleteHidden(expense())).toBe(false);
		const [[id, state] = []] = deleteFailureStates([expense()]);
		expect(id).toBe('e1');
		expect(state).toMatchObject({ status: 'failed', kind: 'delete' });
		expect(state?.error).not.toContain('SQLITE_BUSY');
		expect(refresh).not.toHaveBeenCalled();
		expect(appStore.addNotification).toHaveBeenCalledTimes(2);
		expect(lastAction().label).toBe('Retry');

		retryDelete('e1');
		expect(appStore.dismissToast).toHaveBeenCalledWith('expense-delete-e1');
		await vi.advanceTimersByTimeAsync(0);
		expect(expenseApi.deleteExpense).toHaveBeenCalledTimes(2);
		expect(refresh).toHaveBeenCalledTimes(1);
		expect(deleteFailureStates([expense()])).toEqual([]);
	});
});
