import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { Expense } from '#lib/types/index.ts';

const appStore = vi.hoisted(() => ({ addNotification: vi.fn(), dismissToast: vi.fn() }));
vi.mock('#lib/stores/app.svelte.ts', () => ({ appStore }));
vi.mock('#lib/services/expense-api.ts', () => ({ expenseApi: { updateExpense: vi.fn() } }));

import { expenseApi } from '#lib/services/expense-api.ts';
import { ApiError } from '#lib/utils/error-handling.ts';
import {
	editFailureStates,
	editedRows,
	resetPendingEdits,
	retryEdit,
	scheduleEdit,
	shownExpense
} from '../pending-edits.svelte.ts';

const saved = {
	id: 'e1',
	vehicleId: 'v1',
	tags: [],
	category: 'fuel',
	amount: 40,
	date: '2026-11-20T12:00:00.000Z',
	description: 'Arco',
	updatedAt: '2026-11-20T12:00:00.000Z'
} as unknown as Expense;
const changed = { ...saved, amount: 55, description: 'Shell' };
const payload = { vehicleId: 'v1', category: 'fuel', amount: 55 } as never;

function deferred() {
	let resolve: (value: Expense) => void = () => {};
	let reject: (reason: unknown) => void = () => {};
	const promise = new Promise<Expense>((res, rej) => ((resolve = res), (reject = rej)));
	return { promise, resolve, reject };
}

describe('editing an expense updates the row while the PUT runs', () => {
	beforeEach(() => vi.resetAllMocks());
	afterEach(() => resetPendingEdits());

	function notices(): Record<string, unknown>[] {
		return appStore.addNotification.mock.calls.map(([notice]) => notice as Record<string, unknown>);
	}

	test('the row shows the new values at once, with one success toast, before the PUT answers', async () => {
		const put = deferred();
		vi.mocked(expenseApi.updateExpense).mockReturnValue(put.promise);

		scheduleEdit(saved, changed, payload);

		expect(shownExpense(saved)).toMatchObject({ amount: 55, description: 'Shell' });
		expect(editedRows([saved])).toEqual({ before: [saved], after: [changed] });
		expect(notices()).toEqual([
			expect.objectContaining({ type: 'success', toastId: 'expense-edit-e1' })
		]);
		await vi.waitFor(() => expect(expenseApi.updateExpense).toHaveBeenCalledWith('e1', payload));
	});

	test('a failure replaces the success toast under the same id instead of adding a second', async () => {
		vi.mocked(expenseApi.updateExpense).mockRejectedValueOnce(new ApiError('down', 500));
		scheduleEdit(saved, changed, payload);
		await vi.waitFor(() => expect(notices()).toHaveLength(2));

		const [success, failure] = notices();
		expect(success?.['toastId']).toBe(failure?.['toastId']);
		expect(failure?.['type']).toBe('error');
		expect(appStore.dismissToast).not.toHaveBeenCalled();
	});

	test('a second save waits for the first, and a late failure of the first cannot undo it', async () => {
		const first = deferred();
		const second = deferred();
		vi.mocked(expenseApi.updateExpense)
			.mockReturnValueOnce(first.promise)
			.mockReturnValueOnce(second.promise);
		const again = { ...changed, amount: 70 };
		const againPayload = { vehicleId: 'v1', category: 'fuel', amount: 70 } as never;

		scheduleEdit(saved, changed, payload);
		scheduleEdit(saved, again, againPayload);
		await vi.waitFor(() => expect(expenseApi.updateExpense).toHaveBeenCalledTimes(1));

		first.reject(new ApiError('down', 500));
		await vi.waitFor(() => expect(expenseApi.updateExpense).toHaveBeenCalledTimes(2));
		expect(expenseApi.updateExpense).toHaveBeenLastCalledWith('e1', againPayload);
		expect(shownExpense(saved)).toMatchObject({ amount: 70 });
		expect(editFailureStates([saved])).toEqual([]);

		second.resolve(again);
		await vi.waitFor(() => expect(shownExpense(saved)).toMatchObject({ amount: 70 }));
		expect(notices().filter(n => n['type'] === 'error')).toEqual([]);
	});

	test('a failure note is dropped once the list holds a newer server copy', async () => {
		vi.mocked(expenseApi.updateExpense).mockRejectedValueOnce(new ApiError('down', 500));
		scheduleEdit(saved, changed, payload);
		await vi.waitFor(() => expect(editFailureStates([saved])).toHaveLength(1));

		expect(editFailureStates([{ ...saved, updatedAt: '2026-11-25T09:00:00.000Z' }])).toEqual([]);
	});

	test('a list refreshed after the save shows the server copy, not the overlay', async () => {
		vi.mocked(expenseApi.updateExpense).mockResolvedValue(changed);
		scheduleEdit(saved, changed, payload);
		await Promise.resolve();

		const fresh = { ...saved, amount: 60, updatedAt: '2026-11-25T09:00:00.000Z' };
		expect(shownExpense(fresh)).toBe(fresh);
		expect(shownExpense(saved)).toMatchObject({ amount: 55 });
	});

	test('Undo on the saved toast shows the old values at once and saves them back after the edit', async () => {
		const first = deferred();
		vi.mocked(expenseApi.updateExpense)
			.mockReturnValueOnce(first.promise)
			.mockResolvedValueOnce(saved);
		scheduleEdit(saved, changed, payload, { message: 'Saved $55.00 for Sparky' });
		const toast = notices()[0] ?? {};
		expect(toast).toMatchObject({ message: 'Saved $55.00 for Sparky', duration: 5000 });
		await vi.waitFor(() => expect(expenseApi.updateExpense).toHaveBeenCalledTimes(1));

		(toast['action'] as { label: string; onClick: () => void }).onClick();
		expect(appStore.dismissToast).toHaveBeenCalledWith('expense-edit-e1');
		expect(shownExpense(saved)).toMatchObject({ amount: 40, description: 'Arco' });
		await Promise.resolve();
		expect(expenseApi.updateExpense).toHaveBeenCalledTimes(1);

		first.resolve(changed);
		await vi.waitFor(() => expect(expenseApi.updateExpense).toHaveBeenCalledTimes(2));
		expect(expenseApi.updateExpense).toHaveBeenLastCalledWith(
			'e1',
			expect.objectContaining({ amount: 40, description: 'Arco', category: 'fuel' })
		);
		expect(notices().filter(n => n['type'] === 'error')).toEqual([]);
	});

	function pressUndo(): void {
		const toast = notices().find(n => (n['action'] as { label?: string })?.label === 'Undo');
		(toast?.['action'] as { onClick: () => void }).onClick();
	}

	test('Undo after the edit landed shows the old values on a row the list reloaded', async () => {
		const landed = { ...changed, updatedAt: '2026-11-26T10:00:00.000Z' };
		const restored = { ...saved, updatedAt: '2026-11-26T10:00:05.000Z' };
		const restore = deferred();
		vi.mocked(expenseApi.updateExpense)
			.mockResolvedValueOnce(landed)
			.mockReturnValueOnce(restore.promise);
		scheduleEdit(saved, changed, payload);
		await vi.waitFor(() => expect(expenseApi.updateExpense).toHaveBeenCalledTimes(1));
		await Promise.resolve();
		expect(shownExpense(landed)).toBe(landed);

		pressUndo();
		expect(shownExpense(landed)).toMatchObject({ amount: 40, description: 'Arco' });
		await vi.waitFor(() => expect(expenseApi.updateExpense).toHaveBeenCalledTimes(2));

		restore.resolve(restored);
		await new Promise(resolve => setTimeout(resolve, 0));
		expect(shownExpense(landed)).toMatchObject({ amount: 40, description: 'Arco' });
		expect(editedRows([landed]).after).toEqual([expect.objectContaining({ amount: 40 })]);
		expect(shownExpense(restored)).toBe(restored);
	});

	test('a failed Undo on a reloaded row marks that row as failed', async () => {
		const landed = { ...changed, updatedAt: '2026-11-26T10:00:00.000Z' };
		vi.mocked(expenseApi.updateExpense)
			.mockResolvedValueOnce(landed)
			.mockRejectedValueOnce(new ApiError('down', 500));
		scheduleEdit(saved, changed, payload);
		await vi.waitFor(() => expect(expenseApi.updateExpense).toHaveBeenCalledTimes(1));
		await Promise.resolve();
		pressUndo();
		await vi.waitFor(() => expect(editFailureStates([landed])).toHaveLength(1));
	});

	test('Undo restores a cleared financing link but never resends another kind of link', async () => {
		vi.mocked(expenseApi.updateExpense).mockResolvedValue(changed);
		const financed = { ...saved, sourceType: 'financing', sourceId: 'loan-1' };
		const unlinked = { vehicleId: 'v1', category: 'fuel', amount: 55, sourceType: null };
		scheduleEdit(financed, changed, unlinked as never);
		pressUndo();
		await vi.waitFor(() => expect(expenseApi.updateExpense).toHaveBeenCalledTimes(2));
		expect(expenseApi.updateExpense).toHaveBeenLastCalledWith(
			'e1',
			expect.objectContaining({ sourceType: 'financing', sourceId: 'loan-1' })
		);

		resetPendingEdits();
		vi.mocked(expenseApi.updateExpense).mockClear();
		const reminder = { ...saved, sourceType: 'reminder', sourceId: 'rem-1' };
		scheduleEdit(reminder, changed, payload);
		pressUndo();
		await vi.waitFor(() => expect(expenseApi.updateExpense).toHaveBeenCalledTimes(2));
		const [, restore] = vi.mocked(expenseApi.updateExpense).mock.calls[1] ?? [];
		expect(restore).not.toHaveProperty('sourceType');
	});

	test('a failed Undo says the undo failed, not the edit', async () => {
		vi.mocked(expenseApi.updateExpense)
			.mockResolvedValueOnce(changed)
			.mockRejectedValueOnce(new ApiError('down', 500));
		scheduleEdit(saved, changed, payload);
		pressUndo();
		await vi.waitFor(() =>
			expect(
				notices().some(n => n['message'] === "Couldn't undo your changes to the expense")
			).toBe(true)
		);
	});

	test('a failed PUT reverts the row, keeps its reason, and offers Retry once', async () => {
		vi.mocked(expenseApi.updateExpense).mockRejectedValueOnce(new ApiError('SQLITE_BUSY', 500));
		scheduleEdit(saved, changed, payload);
		await vi.waitFor(() => expect(appStore.addNotification).toHaveBeenCalledTimes(2));

		expect(shownExpense(saved)).toBe(saved);
		expect(editedRows([saved])).toEqual({ before: [], after: [] });
		const [[id, state] = []] = editFailureStates([saved]);
		expect(id).toBe('e1');
		expect(state).toMatchObject({ status: 'failed', kind: 'edit' });
		expect(state?.error).not.toContain('SQLITE_BUSY');
		const notice = notices()[1] ?? {};
		expect(notice['type']).toBe('error');
		expect((notice['action'] as { label: string }).label).toBe('Retry');

		vi.mocked(expenseApi.updateExpense).mockResolvedValueOnce(changed);
		retryEdit('e1');
		expect(appStore.dismissToast).toHaveBeenCalledWith('expense-edit-e1');
		expect(shownExpense(saved)).toMatchObject({ amount: 55 });
		await vi.waitFor(() => expect(editFailureStates([saved])).toEqual([]));
		expect(expenseApi.updateExpense).toHaveBeenCalledTimes(2);
	});
});
