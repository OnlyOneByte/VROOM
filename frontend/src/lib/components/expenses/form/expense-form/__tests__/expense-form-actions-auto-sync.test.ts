import { beforeEach, describe, expect, test, vi } from 'vitest';
import { ApiError } from '#lib/utils/error-handling.ts';

const { createExpense, requestAutoSync, syncSoon, addOfflineExpense } = vi.hoisted(() => ({
	createExpense: vi.fn(),
	requestAutoSync: vi.fn(),
	syncSoon: vi.fn(),
	addOfflineExpense: vi.fn(async () => true)
}));

vi.mock('#lib/services/expense-api.ts', () => ({
	expenseApi: { createExpense, uploadPhoto: vi.fn() }
}));
vi.mock('#lib/stores/app.svelte.ts', () => ({ appStore: { addNotification: vi.fn() } }));
vi.mock('#lib/utils/navigation.ts', () => ({ gotoDynamic: vi.fn(() => Promise.resolve()) }));
vi.mock('#lib/utils/offline-storage.ts', () => ({
	addOfflineExpense,
	currentOfflineQueueOwner: () => null
}));
vi.mock('#lib/stores/offline.svelte.ts', () => ({ onlineStatus: { current: true } }));
vi.mock('#lib/utils/sync/sync-manager.ts', () => ({
	syncManager: { requestAutoSync, syncSoon }
}));

const { ExpenseFormState } = await import('../expense-form-state.svelte');
const { submitExpense } = await import('../expense-form-actions');

function createState() {
	const state = new ExpenseFormState({ expenseId: undefined, returnTo: '/expenses' }, false);
	state.formData.vehicleId = 'v1';
	state.formData.category = 'maintenance';
	state.formData.amount = '120.50';
	state.formData.date = '2025-03-10';
	return state;
}

describe('submitExpense — a queued save is synced', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.spyOn(console, 'error').mockImplementation(() => {});
	});

	test('an online save asks the sync manager to send it at once, without posting directly', async () => {
		await submitExpense(createState());

		expect(addOfflineExpense).toHaveBeenCalledTimes(1);
		expect(syncSoon).toHaveBeenCalledTimes(1);
		expect(createExpense).not.toHaveBeenCalled();
	});

	test('a direct save that fails after the queue could not be written asks for a retry once queued', async () => {
		addOfflineExpense.mockResolvedValueOnce(false);
		createExpense.mockRejectedValueOnce(new ApiError('gateway timeout', 504));

		await submitExpense(createState());

		expect(addOfflineExpense).toHaveBeenCalledTimes(2);
		expect(requestAutoSync).toHaveBeenCalledTimes(1);
	});

	test('a direct save the server refuses is not queued and asks for nothing', async () => {
		addOfflineExpense.mockResolvedValueOnce(false);
		createExpense.mockRejectedValueOnce(new ApiError('Amount must be greater than 0', 400));

		await submitExpense(createState());

		expect(requestAutoSync).not.toHaveBeenCalled();
	});
});
