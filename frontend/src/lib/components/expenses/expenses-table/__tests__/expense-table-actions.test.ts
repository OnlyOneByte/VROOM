import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { Expense } from '#lib/types/index.ts';
import { expenseApi } from '#lib/services/expense-api.ts';
import {
	blockedReasonId,
	deleteExpenseRecord,
	deleteFailureMessage,
	expenseEditHref,
	isInsuranceLinked
} from '../expense-table-actions';

vi.mock('#lib/services/expense-api.ts', () => ({
	expenseApi: {
		deleteExpense: vi.fn(),
		deleteSplitExpense: vi.fn()
	}
}));

function expense(overrides: Partial<Expense>): Expense {
	return {
		id: 'e1',
		vehicleId: 'v1',
		userId: 'u1',
		tags: [],
		category: 'fuel',
		amount: 10,
		date: '2024-03-15T12:00:00.000Z',
		createdAt: '2024-03-15T12:00:00.000Z',
		updatedAt: '2024-03-15T12:00:00.000Z',
		...overrides
	} as Expense;
}

describe('isInsuranceLinked', () => {
	test('is true only when the insurance tag is present', () => {
		expect(isInsuranceLinked(['insurance', 'renewal'])).toBe(true);
		expect(isInsuranceLinked(['service'])).toBe(false);
		expect(isInsuranceLinked([])).toBe(false);
	});
});

describe('blockedReasonId', () => {
	test('derives a stable, group-specific element id', () => {
		expect(blockedReasonId('g-1')).toBe('expense-delete-blocked-g-1');
		expect(blockedReasonId('g-1')).not.toBe(blockedReasonId('g-2'));
	});
});

describe('expenseEditHref', () => {
	test('points at the edit route for the expense and carries the return location', () => {
		const href = expenseEditHref('e-42', '/vehicles/v1');

		expect(href).toContain('e-42');
		expect(href.endsWith('?returnTo=/vehicles/v1')).toBe(true);
	});
});

describe('deleteExpenseRecord', () => {
	beforeEach(() => {
		vi.mocked(expenseApi.deleteExpense).mockReset().mockResolvedValue(undefined);
		vi.mocked(expenseApi.deleteSplitExpense).mockReset().mockResolvedValue(undefined);
	});

	test('deletes a standalone expense by its own id', async () => {
		await deleteExpenseRecord(expense({ id: 'solo' }));

		expect(expenseApi.deleteExpense).toHaveBeenCalledWith('solo');
		expect(expenseApi.deleteSplitExpense).not.toHaveBeenCalled();
	});

	test('deletes the whole split through its group id, never a single sibling', async () => {
		await deleteExpenseRecord(expense({ id: 'sibling', groupId: 'grp' }));

		expect(expenseApi.deleteSplitExpense).toHaveBeenCalledWith('grp');
		expect(expenseApi.deleteExpense).not.toHaveBeenCalled();
	});

	test('propagates a failed request so the caller can report it', async () => {
		vi.mocked(expenseApi.deleteExpense).mockRejectedValue(new Error('network down'));

		await expect(deleteExpenseRecord(expense({ id: 'solo' }))).rejects.toThrow('network down');
	});
});

describe('deleteFailureMessage', () => {
	test('surfaces the message of an Error', () => {
		expect(deleteFailureMessage(new Error('Conflict'))).toBe('Conflict');
	});

	test('falls back to a generic message for anything else', () => {
		expect(deleteFailureMessage('boom')).toBe('Failed to delete expense');
		expect(deleteFailureMessage(undefined)).toBe('Failed to delete expense');
	});
});
