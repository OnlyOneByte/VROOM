import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { authStore } from '#lib/stores/auth.svelte.ts';
import ExpenseActionBar from '../ExpenseActionBar.svelte';
import ExpenseSaveRow from '../ExpenseSaveRow.svelte';

const user = {
	id: 'user-1',
	email: 'a@example.com',
	displayName: 'A',
	createdAt: '2026-01-01T00:00:00Z',
	updatedAt: '2026-01-01T00:00:00Z'
};

afterEach(() => {
	cleanup();
	authStore.clearUser();
});

function mountActionBar() {
	const handlers = { onDelete: vi.fn(), onDuplicate: vi.fn(), onCancel: vi.fn(), onSave: vi.fn() };
	render(ExpenseActionBar, {
		props: {
			isEditMode: true,
			canDuplicate: true,
			isSubmitting: false,
			isDeleting: false,
			...handlers
		}
	});
	return handlers;
}

describe('expense form in the demo garage', () => {
	test('Save, Delete and Duplicate are off, with the reason shown, and Cancel still works', async () => {
		authStore.setUser({ ...user, demo: true });
		const { onSave, onCancel } = mountActionBar();
		expect(screen.getByText('Saving is off in the demo garage.')).toBeInTheDocument();
		for (const name of ['Update Expense', 'Delete', 'Duplicate']) {
			expect(screen.getByRole('button', { name })).toBeDisabled();
		}
		await fireEvent.click(screen.getByRole('button', { name: 'Update Expense' }));
		expect(onSave).not.toHaveBeenCalled();
		await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
		expect(onCancel).toHaveBeenCalledOnce();
	});

	test('the new-expense Save row is off in both layouts', () => {
		authStore.setUser({ ...user, demo: true });
		for (const quick of [false, true]) {
			render(ExpenseSaveRow, { props: { isSubmitting: false, onCancel: vi.fn(), quick } });
			expect(screen.getByRole('button', { name: 'Save Expense' })).toBeDisabled();
			expect(screen.getByText('Saving is off in the demo garage.')).toBeInTheDocument();
			cleanup();
		}
	});

	test('a real user keeps Save and sees no demo note', () => {
		authStore.setUser(user);
		mountActionBar();
		expect(screen.getByRole('button', { name: 'Update Expense' })).toBeEnabled();
		expect(screen.queryByText('Saving is off in the demo garage.')).toBeNull();
	});
});
