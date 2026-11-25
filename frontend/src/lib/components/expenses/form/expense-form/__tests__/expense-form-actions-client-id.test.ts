import { beforeEach, describe, expect, test, vi } from 'vitest';
import { ApiError } from '#lib/utils/error-handling.ts';

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
vi.mock('#lib/utils/offline-storage.ts', () => ({
	addOfflineExpense,
	currentOfflineQueueOwner: () => 'alice'
}));
vi.mock('#lib/stores/offline.svelte.ts', () => ({ onlineStatus: online }));
vi.mock('#lib/utils/sync/sync-manager.ts', () => ({
	syncManager: { syncSoon: vi.fn(), requestAutoSync: vi.fn() }
}));

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
	test('a direct create that fails after reaching the server is re-queued under the same clientId', async () => {
		addOfflineExpense.mockReturnValueOnce(false);
		expenseApiMock.createExpense.mockRejectedValueOnce(new ApiError('gateway timeout', 504));
		const state = createState();

		await submitExpense(state);

		const sentClientId = expenseApiMock.createExpense.mock.calls[0]?.[1];
		expect(sentClientId).toEqual(expect.any(String));
		expect(addOfflineExpense).toHaveBeenCalledWith(expect.anything(), [], sentClientId, 'alice');
	});

	test('each save gets its own clientId', async () => {
		await submitExpense(createState());
		await submitExpense(createState());

		const [first, second] = addOfflineExpense.mock.calls.map(call => (call as unknown[])[2]);
		expect(first).toEqual(expect.any(String));
		expect(first).not.toBe(second);
	});
});
