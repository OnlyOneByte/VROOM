import { beforeEach, describe, expect, test, vi } from 'vitest';
import { ApiError } from '#lib/utils/error-handling.ts';
import { UNQUEUED_SAVE_MESSAGE } from '../expense-submit-outcome';
import { makeExpense, makeSplitGroup } from './expense-form-fixtures';

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

const { ExpenseFormState } = await import('../expense-form-state.svelte');
const { submitExpense, deleteExpense } = await import('../expense-form-actions');

function createState(expenseId?: string) {
	const state = new ExpenseFormState({ expenseId, returnTo: '/expenses' }, false);
	state.formData.vehicleId = 'v1';
	state.formData.category = 'maintenance';
	state.formData.amount = '120.50';
	state.formData.date = '2025-03-10';
	state.formData.description = 'Brakes';
	return state;
}

function notified(type: string, message: string) {
	expect(addNotification).toHaveBeenCalledWith({ type, message });
}

beforeEach(() => {
	vi.clearAllMocks();
	online.current = true;
	addOfflineExpense.mockReturnValue(true);
	vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('submitExpense — validation', () => {
	test('an invalid form marks every field touched and makes no request', async () => {
		const state = createState();
		state.formData.amount = '';
		await submitExpense(state);
		expect(state.errors['amount']).toBe('Amount must be greater than 0');
		expect(Object.keys(state.touched)).toEqual(Object.keys(state.formData));
		expect(Object.values(state.touched).every(Boolean)).toBe(true);
		expect(expenseApiMock.createExpense).not.toHaveBeenCalled();
		expect(state.isSubmitting).toBe(false);
	});
});

describe('submitExpense — online create', () => {
	test('creates the expense, notifies success and navigates back', async () => {
		expenseApiMock.createExpense.mockResolvedValue(makeExpense('new-1'));
		const state = createState();
		await submitExpense(state);
		expect(expenseApiMock.createExpense).toHaveBeenCalledWith(
			expect.objectContaining({
				vehicleId: 'v1',
				category: 'maintenance',
				amount: 120.5,
				description: 'Brakes',
				currency: 'USD'
			}),
			expect.any(String)
		);
		notified('success', 'Expense added successfully');
		expect(gotoDynamic).toHaveBeenCalledWith('/expenses');
		expect(state.isSubmitting).toBe(false);
		expect(state.submitError).toBeNull();
	});

	test('uploads pending photos against the created expense and clears them', async () => {
		expenseApiMock.createExpense.mockResolvedValue(makeExpense('new-2'));
		expenseApiMock.uploadPhoto.mockResolvedValue({});
		const state = createState();
		const file = new File(['x'], 'receipt.jpg', { type: 'image/jpeg' });
		state.pendingFiles = [file];
		await submitExpense(state);
		expect(expenseApiMock.uploadPhoto).toHaveBeenCalledWith('expense', 'new-2', file);
		expect(state.pendingFiles).toEqual([]);
		expect(addNotification).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'warning' }));
	});

	test('warns with a singular message when one photo upload fails', async () => {
		expenseApiMock.createExpense.mockResolvedValue(makeExpense('new-3'));
		expenseApiMock.uploadPhoto.mockRejectedValueOnce(new Error('too big')).mockResolvedValue({});
		const state = createState();
		state.pendingFiles = [new File(['a'], 'a.jpg'), new File(['b'], 'b.jpg')];
		await submitExpense(state);
		notified('warning', '1 photo failed to upload. You can re-upload in edit mode.');
		notified('success', 'Expense added successfully');
	});

	test('warns with a plural message when several photo uploads fail', async () => {
		expenseApiMock.createExpense.mockResolvedValue(makeExpense('new-4'));
		expenseApiMock.uploadPhoto.mockRejectedValue(new Error('down'));
		const state = createState();
		state.pendingFiles = [new File(['a'], 'a.jpg'), new File(['b'], 'b.jpg')];
		await submitExpense(state);
		notified('warning', '2 photos failed to upload. You can re-upload in edit mode.');
	});
});

describe('submitExpense — edit modes', () => {
	test('edit mode updates the existing expense', async () => {
		expenseApiMock.updateExpense.mockResolvedValue(makeExpense('e1'));
		const state = createState('e1');
		await submitExpense(state);
		expect(expenseApiMock.updateExpense).toHaveBeenCalledWith(
			'e1',
			expect.objectContaining({ amount: 120.5 })
		);
		expect(expenseApiMock.createExpense).not.toHaveBeenCalled();
		notified('success', 'Expense updated successfully');
		expect(gotoDynamic).toHaveBeenCalledWith('/expenses');
	});

	test('group edit mode updates the split with the configured allocations', async () => {
		expenseApiMock.updateSplitExpense.mockResolvedValue(makeSplitGroup([]));
		const state = createState('e1');
		state.isGroupEditMode = true;
		state.groupId = 'g1';
		state.splitMethod = 'absolute';
		state.selectedVehicleIds = ['v1', 'v2'];
		state.splitAllocations = [
			{ vehicleId: 'v1', amount: 20.5 },
			{ vehicleId: 'v2', amount: 100 }
		];
		await submitExpense(state);
		expect(expenseApiMock.updateSplitExpense).toHaveBeenCalledWith('g1', {
			splitConfig: {
				method: 'absolute',
				allocations: [
					{ vehicleId: 'v1', amount: 20.5 },
					{ vehicleId: 'v2', amount: 100 }
				]
			},
			totalAmount: 120.5
		});
		expect(expenseApiMock.updateExpense).not.toHaveBeenCalled();
		notified('success', 'Split expense updated successfully');
	});

	test('an edit failure is never queued offline and shows the server message', async () => {
		expenseApiMock.updateExpense.mockRejectedValue(new ApiError('Mileage conflict', 409));
		const state = createState('e1');
		await submitExpense(state);
		expect(addOfflineExpense).not.toHaveBeenCalled();
		expect(state.submitError).toBe('Mileage conflict');
		notified('error', 'Mileage conflict');
		expect(gotoDynamic).not.toHaveBeenCalled();
		expect(state.isSubmitting).toBe(false);
	});

	test('an edit failure from an expired session asks the user to sign in', async () => {
		expenseApiMock.updateExpense.mockRejectedValue(
			new ApiError('Unauthorized', 401, undefined, 'AuthenticationError')
		);
		const state = createState('e1');
		await submitExpense(state);
		expect(state.submitError).toBe('Your session has expired. Please sign in again.');
		expect(addOfflineExpense).not.toHaveBeenCalled();
	});
});

describe('submitExpense — split create', () => {
	test('creates an even split, uploads photos to the first sibling and navigates', async () => {
		expenseApiMock.createSplitExpense.mockResolvedValue(
			makeSplitGroup([makeExpense('sib-1'), makeExpense('sib-2')])
		);
		expenseApiMock.uploadPhoto.mockResolvedValue({});
		const state = createState();
		state.isSplit = true;
		state.selectedVehicleIds = ['v1', 'v2'];
		state.formData.tags = ['shared'];
		const file = new File(['x'], 'r.jpg');
		state.pendingFiles = [file];
		await submitExpense(state);
		expect(expenseApiMock.createSplitExpense).toHaveBeenCalledWith({
			splitConfig: { method: 'even', vehicleIds: ['v1', 'v2'] },
			category: 'maintenance',
			tags: ['shared'],
			date: expect.any(String),
			description: 'Brakes',
			totalAmount: 120.5
		});
		expect(expenseApiMock.uploadPhoto).toHaveBeenCalledWith('expense', 'sib-1', file);
		notified('success', 'Split expense created successfully');
		expect(gotoDynamic).toHaveBeenCalledWith('/expenses');
	});

	test('omits empty tags and description and skips uploads when no sibling is returned', async () => {
		expenseApiMock.createSplitExpense.mockResolvedValue(makeSplitGroup([]));
		const state = createState();
		state.isSplit = true;
		state.selectedVehicleIds = ['v1', 'v2'];
		state.formData.description = '';
		state.pendingFiles = [new File(['x'], 'r.jpg')];
		await submitExpense(state);
		expect(expenseApiMock.createSplitExpense).toHaveBeenCalledWith(
			expect.objectContaining({ tags: undefined, description: undefined })
		);
		expect(expenseApiMock.uploadPhoto).not.toHaveBeenCalled();
		notified('success', 'Split expense created successfully');
	});

	test('a split with only one vehicle selected is saved as a regular expense', async () => {
		expenseApiMock.createExpense.mockResolvedValue(makeExpense('single'));
		const state = createState();
		state.isSplit = true;
		state.selectedVehicleIds = ['v1'];
		await submitExpense(state);
		expect(expenseApiMock.createSplitExpense).not.toHaveBeenCalled();
		expect(expenseApiMock.createExpense).toHaveBeenCalled();
	});
});

describe('submitExpense — offline and failure queuing', () => {
	test('offline saves are queued locally and the user is told they will sync', async () => {
		online.current = false;
		const state = createState();
		await submitExpense(state);
		expect(expenseApiMock.createExpense).not.toHaveBeenCalled();
		expect(addOfflineExpense).toHaveBeenCalledWith(
			expect.objectContaining({ vehicleId: 'v1', amount: 120.5, category: 'maintenance' }),
			[],
			expect.any(String),
			'alice'
		);
		notified('info', 'Expense saved offline. Will sync when online.');
		expect(gotoDynamic).toHaveBeenCalledWith('/expenses');
	});

	test('offline saves queue the pending photos with the expense', async () => {
		online.current = false;
		const photo = new File(['jpeg'], 'receipt.jpg', { type: 'image/jpeg' });
		const state = createState();
		state.pendingFiles = [photo];
		await submitExpense(state);
		expect(addOfflineExpense).toHaveBeenCalledWith(
			expect.anything(),
			[photo],
			expect.any(String),
			'alice'
		);
	});

	test('offline save that cannot be stored keeps the user on the form', async () => {
		online.current = false;
		addOfflineExpense.mockReturnValue(false);
		const state = createState();
		await submitExpense(state);
		expect(state.submitError).toBe(UNQUEUED_SAVE_MESSAGE);
		notified('error', UNQUEUED_SAVE_MESSAGE);
		expect(gotoDynamic).not.toHaveBeenCalled();
		expect(state.isSubmitting).toBe(false);
	});

	test('a transient create failure is queued with a connection warning', async () => {
		expenseApiMock.createExpense.mockRejectedValue(new ApiError('Unavailable', 503));
		const state = createState();
		await submitExpense(state);
		expect(addOfflineExpense).toHaveBeenCalledTimes(1);
		notified('warning', 'Saved offline due to connection issue. Will sync when online.');
		expect(gotoDynamic).toHaveBeenCalledWith('/expenses');
	});

	test('an auth create failure is queued with a sign-in warning', async () => {
		expenseApiMock.createExpense.mockRejectedValue(
			new ApiError('Unauthorized', 401, undefined, 'AuthenticationError')
		);
		const state = createState();
		await submitExpense(state);
		notified('warning', 'Signed out — saved on this device. Sign in to sync it.');
	});

	test('a queued failure that cannot be stored reports the unqueued message', async () => {
		expenseApiMock.createExpense.mockRejectedValue(new TypeError('Failed to fetch'));
		addOfflineExpense.mockReturnValue(false);
		const state = createState();
		await submitExpense(state);
		expect(state.submitError).toBe(UNQUEUED_SAVE_MESSAGE);
		expect(gotoDynamic).not.toHaveBeenCalled();
	});

	test('a terminal create failure is not queued and surfaces the server message', async () => {
		expenseApiMock.createExpense.mockRejectedValue(new ApiError('Invalid category', 422));
		const state = createState();
		await submitExpense(state);
		expect(addOfflineExpense).not.toHaveBeenCalled();
		expect(state.submitError).toBe('Invalid category');
		notified('error', 'Invalid category');
	});

	test('a transient split create failure is not queued', async () => {
		expenseApiMock.createSplitExpense.mockRejectedValue(new ApiError('Bad gateway', 502));
		const state = createState();
		state.isSplit = true;
		state.selectedVehicleIds = ['v1', 'v2'];
		await submitExpense(state);
		expect(addOfflineExpense).not.toHaveBeenCalled();
		expect(state.submitError).toBe('Network error. Please try again.');
	});
});

describe('deleteExpense', () => {
	test('does nothing without an expense id', async () => {
		const state = createState();
		await deleteExpense(state);
		expect(expenseApiMock.deleteExpense).not.toHaveBeenCalled();
		expect(expenseApiMock.deleteSplitExpense).not.toHaveBeenCalled();
	});

	test('deletes a single expense and navigates back', async () => {
		expenseApiMock.deleteExpense.mockResolvedValue(undefined);
		const state = createState('e1');
		state.showDeleteConfirm = true;
		await deleteExpense(state);
		expect(expenseApiMock.deleteExpense).toHaveBeenCalledWith('e1');
		notified('success', 'Expense deleted successfully');
		expect(gotoDynamic).toHaveBeenCalledWith('/expenses');
		expect(state.isDeleting).toBe(false);
		expect(state.showDeleteConfirm).toBe(false);
	});

	test('deletes the whole split group when the expense belongs to one', async () => {
		expenseApiMock.deleteSplitExpense.mockResolvedValue(undefined);
		const state = createState('e1');
		state.groupId = 'g1';
		await deleteExpense(state);
		expect(expenseApiMock.deleteSplitExpense).toHaveBeenCalledWith('g1');
		expect(expenseApiMock.deleteExpense).not.toHaveBeenCalled();
	});

	test('a delete failure notifies, stays on the page and closes the confirm dialog', async () => {
		expenseApiMock.deleteExpense.mockRejectedValue(new Error('500'));
		const state = createState('e1');
		state.showDeleteConfirm = true;
		await deleteExpense(state);
		notified('error', 'Failed to delete expense. Please try again.');
		expect(gotoDynamic).not.toHaveBeenCalled();
		expect(state.isDeleting).toBe(false);
		expect(state.showDeleteConfirm).toBe(false);
	});
});
