import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { Expense } from '#lib/types/index.ts';

const appStore = vi.hoisted(() => ({ addNotification: vi.fn(), dismissToast: vi.fn() }));
vi.mock('#lib/stores/app.svelte.ts', () => ({ appStore }));
vi.mock('#lib/services/expense-api.ts', () => ({
	expenseApi: { updateExpense: vi.fn(), getExpense: vi.fn() }
}));

import { expenseApi } from '#lib/services/expense-api.ts';
import { ApiError, REQUEST_TIMEOUT_MESSAGE } from '#lib/utils/error-handling.ts';
import {
	applyMyChanges,
	reloadLatest,
	EXPENSE_CHANGED_MESSAGE,
	EDIT_TIMEOUT_MS,
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
const signal = { signal: expect.any(AbortSignal) };

function deferred() {
	let resolve: (value: Expense) => void = () => {};
	let reject: (reason: unknown) => void = () => {};
	const promise = new Promise<Expense>((res, rej) => ((resolve = res), (reject = rej)));
	return { promise, resolve, reject };
}

describe('editing an expense updates the row while the PUT runs', () => {
	beforeEach(() => vi.resetAllMocks());
	afterEach(() => resetPendingEdits());

	const flush = () => new Promise(resolve => setTimeout(resolve, 0));

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
		await vi.waitFor(() =>
			expect(expenseApi.updateExpense).toHaveBeenCalledWith('e1', payload, {
				...signal,
				expectedUpdatedAt: saved.updatedAt
			})
		);
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
		expect(expenseApi.updateExpense).toHaveBeenLastCalledWith('e1', againPayload, {
			...signal,
			expectedUpdatedAt: saved.updatedAt
		});
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

		first.resolve({ ...changed, updatedAt: '2026-11-20T12:00:01.000Z' });
		await vi.waitFor(() => expect(expenseApi.updateExpense).toHaveBeenCalledTimes(2));
		expect(expenseApi.updateExpense).toHaveBeenLastCalledWith(
			'e1',
			expect.objectContaining({ amount: 40, description: 'Arco', category: 'fuel' }),
			{ ...signal, expectedUpdatedAt: '2026-11-20T12:00:01.000Z' }
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
		await flush();
		expect(shownExpense(landed)).toMatchObject({ amount: 40, description: 'Arco' });
		expect(editedRows([landed]).after).toEqual([expect.objectContaining({ amount: 40 })]);
		expect(shownExpense(restored)).toBe(restored);
	});

	test('a second Undo click on the fading toast changes nothing', async () => {
		const landed = { ...changed, updatedAt: '2026-11-26T10:00:00.000Z' };
		vi.mocked(expenseApi.updateExpense).mockResolvedValueOnce(landed).mockResolvedValueOnce(saved);
		scheduleEdit(saved, changed, payload);
		await vi.waitFor(() => expect(expenseApi.updateExpense).toHaveBeenCalledTimes(1));
		await flush();

		pressUndo();
		pressUndo();
		await flush();
		expect(shownExpense(landed)).toMatchObject({ amount: 40, description: 'Arco' });
		expect(expenseApi.updateExpense).toHaveBeenCalledTimes(2);
	});

	test('Undo pressed before the save lands still holds once both saves land', async () => {
		const landed = { ...changed, updatedAt: '2026-11-26T10:00:00.000Z' };
		const restored = { ...saved, updatedAt: '2026-11-26T10:00:05.000Z' };
		const edit = deferred();
		const restore = deferred();
		vi.mocked(expenseApi.updateExpense)
			.mockReturnValueOnce(edit.promise)
			.mockReturnValueOnce(restore.promise);
		scheduleEdit(saved, changed, payload);
		pressUndo();

		edit.resolve(landed);
		await vi.waitFor(() => expect(expenseApi.updateExpense).toHaveBeenCalledTimes(2));
		restore.resolve(restored);
		await flush();
		expect(shownExpense(landed)).toMatchObject({ amount: 40, description: 'Arco' });
		expect(shownExpense(restored)).toBe(restored);
	});

	test('with two quick edits in flight, Undo holds on the row of the edit it undid', async () => {
		const again = { ...changed, amount: 70 };
		const firstLanded = { ...changed, updatedAt: '2026-11-26T10:00:00.000Z' };
		const secondLanded = { ...again, updatedAt: '2026-11-26T10:00:01.000Z' };
		const first = deferred();
		const second = deferred();
		vi.mocked(expenseApi.updateExpense)
			.mockReturnValueOnce(first.promise)
			.mockReturnValueOnce(second.promise)
			.mockResolvedValueOnce(saved);
		scheduleEdit(saved, changed, payload);
		scheduleEdit(saved, again, payload);
		pressUndo();

		first.resolve(firstLanded);
		await vi.waitFor(() => expect(expenseApi.updateExpense).toHaveBeenCalledTimes(2));
		second.resolve(secondLanded);
		await vi.waitFor(() => expect(expenseApi.updateExpense).toHaveBeenCalledTimes(3));
		expect(vi.mocked(expenseApi.updateExpense).mock.calls.map(([, , o]) => o)).toEqual([
			{ ...signal, expectedUpdatedAt: saved.updatedAt },
			{ ...signal, expectedUpdatedAt: firstLanded.updatedAt },
			{ ...signal, expectedUpdatedAt: secondLanded.updatedAt }
		]);
		expect(expenseApi.updateExpense).toHaveBeenLastCalledWith(
			'e1',
			expect.objectContaining({ amount: 40, description: 'Arco', category: 'fuel' }),
			expect.objectContaining(signal)
		);
		await flush();
		expect(shownExpense(secondLanded)).toMatchObject({ amount: 40, description: 'Arco' });
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
			expect.objectContaining({ sourceType: 'financing', sourceId: 'loan-1' }),
			expect.objectContaining(signal)
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

	test('an edit the server refuses for lack of access offers no Retry, in the toast or on the row', async () => {
		vi.mocked(expenseApi.updateExpense).mockRejectedValueOnce(new ApiError('no access', 403));
		scheduleEdit(saved, changed, payload);
		await vi.waitFor(() => expect(notices()).toHaveLength(2));

		expect(notices()[1]).toMatchObject({ type: 'error' });
		expect(notices()[1]).not.toHaveProperty('action');
		expect(editFailureStates([saved])).toEqual([
			['e1', expect.objectContaining({ status: 'failed', kind: 'edit', editable: false })]
		]);
	});

	test('a Retry that succeeds says so in place of the error toast', async () => {
		vi.mocked(expenseApi.updateExpense)
			.mockRejectedValueOnce(new ApiError('down', 500))
			.mockResolvedValueOnce(changed);
		scheduleEdit(saved, changed, payload);
		await vi.waitFor(() => expect(editFailureStates([saved])).toHaveLength(1));

		retryEdit('e1');
		await vi.waitFor(() => expect(notices()).toHaveLength(3));
		expect(notices()[2]).toMatchObject({
			type: 'success',
			message: 'Expense updated successfully',
			toastId: 'expense-edit-e1',
			duration: 5000,
			action: { label: 'Undo' }
		});
	});

	test('a retried Undo that succeeds says the changes were undone, and a plain save adds no second toast', async () => {
		vi.mocked(expenseApi.updateExpense)
			.mockResolvedValueOnce(changed)
			.mockRejectedValueOnce(new ApiError('down', 500))
			.mockResolvedValueOnce(saved);
		scheduleEdit(saved, changed, payload);
		await vi.waitFor(() => expect(expenseApi.updateExpense).toHaveBeenCalledTimes(1));
		await flush();
		expect(notices()).toHaveLength(1);

		pressUndo();
		await vi.waitFor(() => expect(notices()).toHaveLength(2));
		retryEdit('e1');
		await vi.waitFor(() => expect(notices()).toHaveLength(3));
		expect(notices()[2]).toMatchObject({
			type: 'success',
			message: 'Your changes to the expense were undone'
		});
	});
});

describe('a save that never answers times out', () => {
	beforeEach(() => {
		vi.resetAllMocks();
		vi.useFakeTimers();
	});
	afterEach(() => {
		resetPendingEdits();
		vi.useRealTimers();
	});

	const server: { rows: Record<string, Expense>; applied: unknown[] } = { rows: {}, applied: [] };

	type PutArgs = Parameters<typeof expenseApi.updateExpense>;

	function stale(id: string, options: PutArgs[2]): ApiError | undefined {
		const current = server.rows[id]?.updatedAt ?? saved.updatedAt;
		if (!options?.expectedUpdatedAt || options.expectedUpdatedAt === current) return undefined;
		return new ApiError('changed', 409, { updatedAt: current }, 'EXPENSE_CHANGED');
	}

	const formPayload = {
		vehicleId: 'v1',
		tags: [],
		category: 'fuel' as const,
		amount: 55,
		date: '2026-11-20T12:00:00Z',
		description: 'Shell',
		currency: 'USD',
		missedFillup: false,
		sourceType: undefined,
		sourceId: undefined
	};

	function store(id: string, body: PutArgs[1], updatedAt: string): Expense {
		server.applied.push(body);
		const written = Object.entries(body).filter(([k, v]) => k !== 'currency' && v !== undefined);
		const current = server.rows[id] ?? { ...saved, missedFillup: false };
		server.rows[id] = { ...current, ...Object.fromEntries(written), updatedAt } as Expense;
		return server.rows[id];
	}

	function appliedButNeverAnswered(...[id, body, options]: PutArgs) {
		const refused = stale(id, options);
		if (refused) return Promise.reject(refused);
		store(id, body, '2026-11-26T10:00:00.000Z');
		return new Promise<Expense>((_, reject) => {
			options?.signal?.addEventListener('abort', () => reject(options.signal?.reason));
		});
	}

	function appliedAndAnswered(...[id, body, options]: PutArgs) {
		const refused = stale(id, options);
		if (refused) return Promise.reject(refused);
		return Promise.resolve(store(id, body, '2026-11-26T10:00:20.000Z'));
	}

	beforeEach(() => {
		server.rows = {};
		server.applied = [];
		vi.mocked(expenseApi.getExpense).mockImplementation(async id => server.rows[id] ?? saved);
	});

	test('it fails into "Changes not saved" with Retry, and the next save of the expense goes out', async () => {
		vi.mocked(expenseApi.updateExpense)
			.mockImplementationOnce(appliedButNeverAnswered)
			.mockImplementationOnce(appliedAndAnswered);
		scheduleEdit(saved, changed, formPayload);
		await vi.advanceTimersByTimeAsync(EDIT_TIMEOUT_MS - 1);
		expect(editFailureStates([saved])).toEqual([]);
		expect(shownExpense(saved)).toMatchObject({ amount: 55 });

		await vi.advanceTimersByTimeAsync(1);
		expect(editFailureStates([saved])).toEqual([
			['e1', { status: 'failed', kind: 'edit', error: REQUEST_TIMEOUT_MESSAGE }]
		]);
		const failure = appStore.addNotification.mock.calls.at(-1)?.[0] as Record<string, unknown>;
		expect(failure).toMatchObject({ type: 'error', action: { label: 'Retry' } });

		const again = { ...changed, amount: 70 };
		scheduleEdit(saved, again, formPayload);
		await vi.advanceTimersByTimeAsync(0);
		expect(expenseApi.updateExpense).toHaveBeenCalledTimes(2);
	});

	test('a save queued behind a hung one that landed goes out against the landed version', async () => {
		vi.mocked(expenseApi.updateExpense).mockImplementation(appliedAndAnswered);
		vi.mocked(expenseApi.updateExpense).mockImplementationOnce(appliedButNeverAnswered);
		scheduleEdit(saved, changed, formPayload);
		await vi.advanceTimersByTimeAsync(1000);
		const again = { ...changed, amount: 70 };
		const againPayload = { ...formPayload, amount: 70 };
		scheduleEdit(saved, again, againPayload);

		await vi.advanceTimersByTimeAsync(EDIT_TIMEOUT_MS - 1001);
		expect(expenseApi.updateExpense).toHaveBeenCalledTimes(1);

		await vi.advanceTimersByTimeAsync(1);
		await vi.advanceTimersByTimeAsync(0);
		expect(expenseApi.updateExpense).toHaveBeenCalledTimes(3);
		expect(expenseApi.updateExpense).toHaveBeenLastCalledWith('e1', againPayload, {
			...signal,
			expectedUpdatedAt: '2026-11-26T10:00:00.000Z'
		});
		expect(server.applied).toEqual([formPayload, againPayload]);
		expect(server.rows['e1']).toMatchObject({ amount: 70 });
		expect(editFailureStates([saved])).toEqual([]);
		expect(shownExpense(saved)).toMatchObject({ amount: 70 });
	});

	test('after a timed-out save, a refusal for a change someone else made still shows the conflict', async () => {
		vi.mocked(expenseApi.updateExpense)
			.mockImplementationOnce(appliedButNeverAnswered)
			.mockImplementationOnce(appliedAndAnswered);
		scheduleEdit(saved, changed, formPayload);
		await vi.advanceTimersByTimeAsync(EDIT_TIMEOUT_MS);
		server.rows['e1'] = { ...saved, amount: 99, updatedAt: '2026-11-26T10:00:10.000Z' };

		retryEdit('e1');
		await vi.advanceTimersByTimeAsync(0);
		expect(expenseApi.getExpense).toHaveBeenCalledWith('e1', signal);
		expect(server.applied).toEqual([formPayload]);
		expect(editFailureStates([saved])).toEqual([
			['e1', expect.objectContaining({ error: EXPENSE_CHANGED_MESSAGE, conflict: true })]
		]);
	});

	test('Retry after a timed-out save the server had applied finds its own save, not a conflict, and the row settles on it', async () => {
		vi.mocked(expenseApi.updateExpense)
			.mockImplementationOnce(appliedButNeverAnswered)
			.mockImplementationOnce(appliedAndAnswered);
		scheduleEdit(saved, changed, formPayload);
		await vi.advanceTimersByTimeAsync(EDIT_TIMEOUT_MS);
		expect(editFailureStates([saved])).toHaveLength(1);

		retryEdit('e1');
		await vi.advanceTimersByTimeAsync(0);

		const calls = vi.mocked(expenseApi.updateExpense).mock.calls;
		expect(calls.map(([id]) => id)).toEqual(['e1', 'e1']);
		expect(server.applied).toEqual([formPayload]);
		expect(expenseApi.getExpense).toHaveBeenCalledWith('e1', signal);
		expect(Object.keys(server.rows)).toEqual(['e1']);
		expect(editFailureStates([saved])).toEqual([]);
		expect(shownExpense(saved)).toMatchObject({ amount: 55, description: 'Shell' });
		const reloaded = server.rows['e1']!;
		expect(shownExpense(reloaded)).toBe(reloaded);
		expect(editFailureStates([reloaded])).toEqual([]);
	});

	test('Retry after a timed-out form save on a financing-linked expense also finds its own save', async () => {
		server.rows['e1'] = { ...saved, sourceType: 'financing', sourceId: 'loan-1' } as Expense;
		vi.mocked(expenseApi.updateExpense)
			.mockImplementationOnce(appliedButNeverAnswered)
			.mockImplementationOnce(appliedAndAnswered);
		scheduleEdit(saved, changed, formPayload);
		await vi.advanceTimersByTimeAsync(EDIT_TIMEOUT_MS);

		retryEdit('e1');
		await vi.advanceTimersByTimeAsync(0);
		expect(server.applied).toEqual([formPayload]);
		expect(server.rows['e1']).toMatchObject({ sourceType: 'financing', amount: 55 });
		expect(editFailureStates([saved])).toEqual([]);
	});

	test('a list reloaded after the timed-out save landed shows the saved values with no failure note', async () => {
		vi.mocked(expenseApi.updateExpense).mockImplementationOnce(appliedButNeverAnswered);
		scheduleEdit(saved, changed, formPayload);
		await vi.advanceTimersByTimeAsync(EDIT_TIMEOUT_MS);

		const reloaded = server.rows['e1']!;
		expect(shownExpense(reloaded)).toMatchObject({ amount: 55, description: 'Shell' });
		expect(editFailureStates([reloaded])).toEqual([]);
	});
});

describe('an edit refused because the expense changed elsewhere', () => {
	beforeEach(() => vi.resetAllMocks());
	afterEach(() => resetPendingEdits());

	const elsewhere = '2026-11-20T12:05:00.000Z';
	const changedElsewhere = () =>
		new ApiError('changed', 409, { updatedAt: elsewhere }, 'EXPENSE_CHANGED');

	function lastNotice(): Record<string, unknown> {
		return (appStore.addNotification.mock.calls.at(-1)?.[0] ?? {}) as Record<string, unknown>;
	}

	async function conflicted(): Promise<void> {
		vi.mocked(expenseApi.updateExpense).mockRejectedValueOnce(changedElsewhere());
		scheduleEdit(saved, changed, payload);
		await vi.waitFor(() => expect(editFailureStates([saved])).toHaveLength(1));
	}

	test('a list already showing the other change marks that row, and shows my edit once applied', async () => {
		const theirs = { ...saved, amount: 45, updatedAt: elsewhere };
		vi.mocked(expenseApi.updateExpense).mockRejectedValueOnce(changedElsewhere());
		scheduleEdit(saved, changed, payload);
		await vi.waitFor(() => expect(editFailureStates([theirs])).toHaveLength(1));
		expect(shownExpense(theirs)).toBe(theirs);

		vi.mocked(expenseApi.updateExpense).mockResolvedValueOnce({
			...changed,
			updatedAt: '2026-11-20T12:05:01.000Z'
		});
		applyMyChanges('e1');
		await vi.waitFor(() => expect(editFailureStates([theirs])).toEqual([]));
		expect(shownExpense(theirs)).toMatchObject({ amount: 55, description: 'Shell' });
	});

	test('keeps the edit, marks the row and offers to apply it', async () => {
		await conflicted();

		expect(editFailureStates([saved])).toEqual([
			['e1', { status: 'failed', kind: 'edit', error: EXPENSE_CHANGED_MESSAGE, conflict: true }]
		]);
		expect(shownExpense(saved)).toBe(saved);
		expect(lastNotice()).toMatchObject({
			type: 'error',
			message: EXPENSE_CHANGED_MESSAGE,
			toastId: 'expense-edit-e1',
			action: expect.objectContaining({ label: 'Apply my changes' })
		});
		retryEdit('e1');
		expect(expenseApi.updateExpense).toHaveBeenCalledTimes(1);
	});

	test('Apply my changes re-sends the same edit against the current version', async () => {
		await conflicted();
		vi.mocked(expenseApi.updateExpense).mockResolvedValueOnce({
			...changed,
			updatedAt: '2026-11-20T12:05:01.000Z'
		});

		applyMyChanges('e1');
		expect(appStore.dismissToast).toHaveBeenCalledWith('expense-edit-e1');
		expect(shownExpense(saved)).toMatchObject({ amount: 55 });
		await vi.waitFor(() => expect(expenseApi.updateExpense).toHaveBeenCalledTimes(2));
		expect(expenseApi.updateExpense).toHaveBeenLastCalledWith('e1', payload, {
			...signal,
			expectedUpdatedAt: elsewhere
		});
		await vi.waitFor(() => expect(editFailureStates([saved])).toEqual([]));
	});

	test('with no current version in the refusal, Apply my changes sends without a check', async () => {
		vi.mocked(expenseApi.updateExpense).mockRejectedValueOnce(
			new ApiError('changed', 409, { updatedAt: null }, 'EXPENSE_CHANGED')
		);
		scheduleEdit(saved, changed, payload);
		await vi.waitFor(() => expect(editFailureStates([saved])).toHaveLength(1));
		vi.mocked(expenseApi.updateExpense).mockResolvedValueOnce(changed);

		applyMyChanges('e1');
		await vi.waitFor(() => expect(expenseApi.updateExpense).toHaveBeenCalledTimes(2));
		expect(expenseApi.updateExpense).toHaveBeenLastCalledWith('e1', payload, {
			...signal,
			expectedUpdatedAt: undefined
		});
	});

	const reloaded = { ...saved, amount: 45, updatedAt: elsewhere };

	test('Reload shows the fresh copy on that row and drops only that edit', async () => {
		const other = { ...saved, id: 'e2' };
		vi.mocked(expenseApi.updateExpense).mockRejectedValueOnce(new ApiError('down', 500));
		scheduleEdit(other, { ...other, amount: 99 }, payload);
		await vi.waitFor(() => expect(editFailureStates([other])).toHaveLength(1));
		await conflicted();
		vi.mocked(expenseApi.getExpense).mockResolvedValueOnce(reloaded);

		await reloadLatest('e1');
		expect(expenseApi.getExpense).toHaveBeenCalledWith('e1');
		expect(appStore.dismissToast).toHaveBeenCalledWith('expense-edit-e1');
		expect(shownExpense(saved)).toMatchObject({ amount: 45, updatedAt: elsewhere });
		expect(editFailureStates([shownExpense(saved)])).toEqual([]);
		expect(editFailureStates([other])).toHaveLength(1);
	});

	test('if the fresh copy cannot be loaded, the conflict and my edit stay', async () => {
		await conflicted();
		vi.mocked(expenseApi.getExpense).mockRejectedValueOnce(new ApiError('down', 500));

		await reloadLatest('e1');
		expect(editFailureStates([saved])).toEqual([
			['e1', expect.objectContaining({ conflict: true })]
		]);
		expect(lastNotice()).toMatchObject({
			type: 'error',
			message: "Couldn't load the latest version of the expense"
		});
	});

	test('a Retry after a timed-out save checks against the last known version', async () => {
		vi.mocked(expenseApi.updateExpense).mockRejectedValueOnce(new ApiError('timeout', 408));
		scheduleEdit(saved, changed, payload);
		await vi.waitFor(() => expect(editFailureStates([saved])).toHaveLength(1));
		vi.mocked(expenseApi.updateExpense).mockRejectedValueOnce(changedElsewhere());

		retryEdit('e1');
		await vi.waitFor(() =>
			expect(editFailureStates([saved])).toEqual([
				['e1', expect.objectContaining({ conflict: true })]
			])
		);
		expect(expenseApi.updateExpense).toHaveBeenLastCalledWith('e1', payload, {
			...signal,
			expectedUpdatedAt: saved.updatedAt
		});
	});

	test('a later edit after a reload checks against the reloaded version', async () => {
		await conflicted();
		vi.mocked(expenseApi.getExpense).mockResolvedValueOnce(reloaded);
		await reloadLatest('e1');
		vi.mocked(expenseApi.updateExpense).mockResolvedValueOnce(reloaded);

		scheduleEdit(reloaded, { ...reloaded, amount: 50 }, payload);
		await vi.waitFor(() => expect(expenseApi.updateExpense).toHaveBeenCalledTimes(2));
		expect(expenseApi.updateExpense).toHaveBeenLastCalledWith('e1', payload, {
			...signal,
			expectedUpdatedAt: elsewhere
		});
	});
});
