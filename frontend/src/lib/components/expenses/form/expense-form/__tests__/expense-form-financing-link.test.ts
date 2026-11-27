import { beforeEach, describe, expect, test, vi } from 'vitest';
import { makeExpense } from './expense-form-fixtures';

const { expenseApiMock } = vi.hoisted(() => ({
	expenseApiMock: {
		getExpense: vi.fn(),
		getSplitExpense: vi.fn(),
		getExpensesByVehicle: vi.fn(),
		updateExpense: vi.fn(() => Promise.resolve({}))
	}
}));

vi.mock('#lib/services/expense-api.ts', () => ({ expenseApi: expenseApiMock }));
vi.mock('#lib/services/vehicle-api.ts', () => ({ vehicleApi: {} }));
vi.mock('#lib/stores/app.svelte.ts', () => ({
	appStore: { addNotification: vi.fn(), dismissToast: vi.fn() }
}));
vi.mock('#lib/utils/navigation.ts', () => ({ gotoDynamic: vi.fn(() => Promise.resolve()) }));

const { ExpenseFormState } = await import('../expense-form-state.svelte');
const { loadExpense } = await import('../expense-form-loaders');
const { submitExpense } = await import('../expense-form-actions');

function editState() {
	return new ExpenseFormState({ expenseId: 'e1', returnTo: '/expenses' }, true);
}

beforeEach(() => vi.clearAllMocks());

describe('editing a financing payment', () => {
	test('loads the link, and keeps it unless the user moves the expense off it', async () => {
		expenseApiMock.getExpense.mockResolvedValue(
			makeExpense('e1', { category: 'financial', sourceType: 'financing', sourceId: 'f1' })
		);
		const state = editState();
		await loadExpense(state);
		expect(state.isFinancingPayment).toBe(true);
		expect(state.clearsFinancingLink).toBe(false);

		state.selectCategory('maintenance');
		expect(state.isFinancingPayment).toBe(false);
		expect(state.clearsFinancingLink).toBe(true);
	});

	test('other links are not loaded and never cleared', async () => {
		expenseApiMock.getExpense.mockResolvedValue(
			makeExpense('e1', { category: 'misc', sourceType: 'reminder', sourceId: 'r1' })
		);
		const state = editState();
		await loadExpense(state);
		expect(state.sourceType).toBeNull();
		state.selectCategory('maintenance');
		expect(state.clearsFinancingLink).toBe(false);
	});

	test('saving sends the null pair only when the link was cleared', async () => {
		expenseApiMock.getExpense.mockResolvedValue(
			makeExpense('e1', { category: 'financial', sourceType: 'financing', sourceId: 'f1' })
		);
		const kept = editState();
		await loadExpense(kept);
		await submitExpense(kept);
		await vi.waitFor(() =>
			expect(expenseApiMock.updateExpense).toHaveBeenLastCalledWith(
				'e1',
				expect.objectContaining({ sourceType: undefined, sourceId: undefined }),
				{ signal: expect.any(AbortSignal) }
			)
		);

		const cleared = editState();
		await loadExpense(cleared);
		cleared.selectCategory('maintenance');
		await submitExpense(cleared);
		await vi.waitFor(() =>
			expect(expenseApiMock.updateExpense).toHaveBeenLastCalledWith(
				'e1',
				expect.objectContaining({ sourceType: null, sourceId: null }),
				{ signal: expect.any(AbortSignal) }
			)
		);
	});
});
