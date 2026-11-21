import { describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import ExpenseDeleteDialog from '../ExpenseDeleteDialog.svelte';
import type { Expense } from '#lib/types/index.ts';

const EXPENSE: Expense = {
	id: 'e1',
	vehicleId: 'v1',
	userId: 'u1',
	tags: ['oil', 'service'],
	category: 'maintenance',
	amount: 89.5,
	date: '2026-03-15T12:00:00.000Z',
	description: 'Synthetic oil change',
	createdAt: '2026-03-15T12:00:00.000Z',
	updatedAt: '2026-03-15T12:00:00.000Z'
};

interface Options {
	isInsuranceManaged?: boolean;
	isGroupEditMode?: boolean;
	groupId?: string | null;
	originalExpense?: Expense | null;
	isDeleting?: boolean;
}

function renderDialog(options: Options = {}) {
	const onConfirm = vi.fn();
	render(ExpenseDeleteDialog, {
		open: true,
		isInsuranceManaged: options.isInsuranceManaged ?? false,
		isGroupEditMode: options.isGroupEditMode ?? false,
		groupId: options.groupId ?? null,
		originalExpense: options.originalExpense === undefined ? EXPENSE : options.originalExpense,
		isDeleting: options.isDeleting ?? false,
		onConfirm
	});
	return { onConfirm };
}

async function description(): Promise<string> {
	const dialog = await screen.findByRole('alertdialog');
	const id = dialog.getAttribute('aria-describedby');
	const el = id ? document.getElementById(id) : null;
	return el?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
}

describe('ExpenseDeleteDialog: warning text', () => {
	test('a standalone expense gets the generic warning', async () => {
		renderDialog();

		expect(await description()).toBe(
			'Are you sure you want to delete this expense? This action cannot be undone.'
		);
	});

	test('an insurance-managed group warns that all child expenses go', async () => {
		renderDialog({ isInsuranceManaged: true, groupId: 'g1' });

		expect(await description()).toContain('delete the insurance expense group and all its child');
	});

	test('a split group warns that every vehicle portion goes', async () => {
		renderDialog({ isGroupEditMode: true, groupId: 'g1' });

		expect(await description()).toContain("removes the entire split — every vehicle's portion");
	});

	test.each<[string, Options]>([
		['insurance-managed', { isInsuranceManaged: true }],
		['group edit', { isGroupEditMode: true }]
	])('%s without a group id falls back to the generic warning', async (_label, options) => {
		renderDialog(options);

		expect(await description()).toMatch(/^Are you sure/);
	});
});

describe('ExpenseDeleteDialog: expense summary', () => {
	test('summarizes the description, amount and date', async () => {
		renderDialog();

		expect(await screen.findByText('Synthetic oil change')).toBeInTheDocument();
		expect(
			screen.getByText(`$89.50 on ${new Date(EXPENSE.date).toLocaleDateString()}`)
		).toBeInTheDocument();
	});

	test('falls back to the tags when there is no description', async () => {
		renderDialog({ originalExpense: { ...EXPENSE, description: undefined } });

		expect(await screen.findByText('oil, service')).toBeInTheDocument();
	});

	test('falls back to a generic name with neither description nor tags', async () => {
		renderDialog({ originalExpense: { ...EXPENSE, description: '', tags: [] } });

		expect(await screen.findByText('Expense')).toBeInTheDocument();
	});

	test('omits the summary when the expense is unknown', async () => {
		renderDialog({ originalExpense: null });

		await screen.findByRole('alertdialog');
		expect(screen.queryByText(/\$89\.50/)).toBeNull();
	});
});

describe('ExpenseDeleteDialog: actions', () => {
	test('confirming calls onConfirm', async () => {
		const { onConfirm } = renderDialog();

		await fireEvent.click(await screen.findByRole('button', { name: 'Delete Expense' }));

		expect(onConfirm).toHaveBeenCalledTimes(1);
	});

	test('while deleting both buttons are disabled and progress is shown', async () => {
		renderDialog({ isDeleting: true });

		const confirm = await screen.findByRole('button', { name: /Deleting\.\.\./ });
		expect(confirm).toBeDisabled();
		expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
		expect(screen.queryByRole('button', { name: 'Delete Expense' })).toBeNull();
	});
});
