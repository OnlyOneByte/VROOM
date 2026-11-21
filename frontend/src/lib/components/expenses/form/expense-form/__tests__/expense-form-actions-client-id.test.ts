import { beforeEach, describe, expect, test, vi } from 'vitest';
import { ApiError } from '#lib/utils/error-handling.ts';
import { makeExpense } from './expense-form-fixtures';

const { expenseApiMock, addNotification, gotoDynamic, addOfflineExpense, online } = vi.hoisted(
	() => ({
		expenseApiMock: {
			createExpense: vi.fn(),
			updateExpense: vi.fn(),
			deleteExpense: vi.fn(),
			uploadPhoto: vi.fn(),
			createSplitExpense: vi.fn(),
			updateSplitExpense: vi.fn(),
			deleteSplitExpense: vi.fn()
		},
		addNotification: vi.fn(),
		gotoDynamic: vi.fn(() => Promise.resolve()),
		addOfflineExpense: vi.fn(() => true),
		online: { current: true }
	})
);

vi.mock('#lib/services/expense-api.ts', () => ({ expenseApi: expenseApiMock }));
vi.mock('#lib/stores/app.svelte.ts', () => ({ appStore: { addNotification } }));
vi.mock('#lib/utils/navigation.ts', () => ({ gotoDynamic }));
vi.mock('#lib/utils/offline-storage.ts', () => ({ addOfflineExpense }));
vi.mock('#lib/stores/offline.svelte.ts', () => ({ onlineStatus: online }));

const { ExpenseFormState } = await import('../expense-form-state.svelte');
const { submitExpense } = await import('../expense-form-actions');

function createState(expenseId?: string) {
	const state = new ExpenseFormState({ expenseId, returnTo: '/expenses' }, false);
	state.formData.vehicleId = 'v1';
	state.formData.category = 'maintenance';
	state.formData.amount = '120.50';
	state.formData.date = '2025-03-10';
	state.formData.description = 'Brakes';
	return state;
}

beforeEach(() => {
	vi.clearAllMocks();
	online.current = true;
	addOfflineExpense.mockReturnValue(true);
	vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('submitExpense — one clientId per save', () => {
	test('a create that fails after reaching the server is re-queued under the same clientId', async () => {
		expenseApiMock.createExpense.mockRejectedValueOnce(new ApiError('gateway timeout', 504));
		const state = createState();

		await submitExpense(state);

		const sentClientId = expenseApiMock.createExpense.mock.calls[0]?.[1];
		expect(sentClientId).toEqual(expect.any(String));
		expect(addOfflineExpense).toHaveBeenCalledWith(expect.anything(), [], sentClientId);
	});

	test('each save gets its own clientId', async () => {
		expenseApiMock.createExpense.mockResolvedValue(makeExpense('e1'));

		await submitExpense(createState());
		await submitExpense(createState());

		const [first, second] = expenseApiMock.createExpense.mock.calls.map(call => call[1]);
		expect(first).not.toBe(second);
	});
});
