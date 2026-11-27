import { describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import ExpenseDeleteDialog from '../ExpenseDeleteDialog.svelte';
import TableDeleteDialog from '../../../expenses-table/ExpenseDeleteDialog.svelte';
import type { Expense, Vehicle } from '#lib/types/index.ts';

const EXPENSE: Expense = {
	id: 'e1',
	vehicleId: 'v1',
	userId: 'u1',
	tags: ['oil', 'service'],
	category: 'maintenance',
	amount: 89.5,
	date: new Date(2026, 2, 15, 12).toISOString(),
	description: 'Synthetic oil change',
	createdAt: '2026-03-15T12:00:00.000Z',
	updatedAt: '2026-03-15T12:00:00.000Z'
};

const SPARKY = {
	id: 'v1',
	make: 'Tesla',
	model: 'Model 3',
	year: 2022,
	nickname: 'Sparky'
} as Vehicle;

const UNDO = 'Its photos and receipts go too. You can undo it for 5 seconds.';

interface Options {
	isInsuranceManaged?: boolean;
	isGroupEditMode?: boolean;
	groupId?: string | null;
	originalExpense?: Expense | null;
	vehicle?: Vehicle | null;
	onConfirm?: () => Promise<void>;
}

function renderDialog(options: Options = {}) {
	const onConfirm = vi.fn(options.onConfirm ?? (() => Promise.resolve()));
	render(ExpenseDeleteDialog, {
		open: true,
		isInsuranceManaged: options.isInsuranceManaged ?? false,
		isGroupEditMode: options.isGroupEditMode ?? false,
		groupId: options.groupId ?? null,
		originalExpense: options.originalExpense === undefined ? EXPENSE : options.originalExpense,
		vehicle: options.vehicle === undefined ? SPARKY : options.vehicle,
		onConfirm
	});
	return { onConfirm };
}

async function description(): Promise<string> {
	const dialog = await screen.findByRole('alertdialog', { name: 'Delete expense?' });
	const id = dialog.getAttribute('aria-describedby');
	const el = id ? document.getElementById(id) : null;
	return el?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
}

describe('ExpenseDeleteDialog: what it says', () => {
	test('names the expense, its vehicle, amount and day, then says Undo is available', async () => {
		renderDialog();

		expect(await description()).toBe(
			`“Synthetic oil change” for Sparky, $89.50 on Mar 15, 2026. ${UNDO}`
		);
	});

	test('falls back to the category name, and leaves the vehicle out when it is unknown', async () => {
		renderDialog({ originalExpense: { ...EXPENSE, description: '  ' }, vehicle: null });

		expect(await description()).toBe(`“Maintenance”, $89.50 on Mar 15, 2026. ${UNDO}`);
	});

	const GROUP_CHILD = { ...EXPENSE, groupId: 'g1', amount: 50, groupTotal: 100 };

	test('an insurance-managed group warns that the whole group goes and shows its total', async () => {
		renderDialog({ isInsuranceManaged: true, groupId: 'g1', originalExpense: GROUP_CHILD });

		const text = await description();
		expect(text).toContain('deletes the whole insurance group');
		expect(text).toContain('$100.00');
	});

	test('a split group shows the total being deleted and names no single vehicle', async () => {
		renderDialog({ isGroupEditMode: true, groupId: 'g1', originalExpense: GROUP_CHILD });

		const text = await description();
		expect(text).toBe(
			`“Synthetic oil change”, $100.00 on Mar 15, 2026. It's a split expense, so every vehicle's share is deleted. ${UNDO}`
		);
	});

	test('the table dialog shows a split row’s total too', async () => {
		render(TableDeleteDialog, {
			open: true,
			expense: GROUP_CHILD,
			vehicle: SPARKY,
			onConfirm: () => Promise.resolve()
		});

		expect(await description()).toContain('$100.00 on Mar 15, 2026');
	});

	test('the amount is shown in the expense’s own currency', async () => {
		renderDialog({ originalExpense: { ...EXPENSE, currency: 'EUR' } });

		expect(await description()).toContain('€89.50');
	});

	test.each<[string, Options]>([
		['insurance-managed', { isInsuranceManaged: true }],
		['group edit', { isGroupEditMode: true }]
	])('%s without a group id reads as a single expense', async (_label, options) => {
		renderDialog(options);

		expect(await description()).toMatch(/^“Synthetic oil change” for Sparky/);
	});

	test('the table dialog says the same for the same expense', async () => {
		render(TableDeleteDialog, {
			open: true,
			expense: EXPENSE,
			vehicle: SPARKY,
			onConfirm: () => Promise.resolve()
		});

		expect(await description()).toBe(
			`“Synthetic oil change” for Sparky, $89.50 on Mar 15, 2026. ${UNDO}`
		);
	});
});

describe('ExpenseDeleteDialog: actions', () => {
	test('confirming calls onConfirm', async () => {
		const { onConfirm } = renderDialog();

		await fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));

		expect(onConfirm).toHaveBeenCalledTimes(1);
	});

	test('while deleting, the confirm button keeps focus and Cancel is disabled', async () => {
		let reject: (reason: unknown) => void = () => {};
		renderDialog({ onConfirm: () => new Promise((_, r) => (reject = r)) });
		const confirm = await screen.findByRole('button', { name: 'Delete' });
		confirm.focus();

		await fireEvent.click(confirm);

		expect(confirm).toHaveTextContent('Working…');
		expect(confirm).toHaveAttribute('aria-disabled', 'true');
		expect(confirm).not.toBeDisabled();
		expect(document.activeElement).toBe(confirm);
		expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
		reject(new Error('offline'));
	});

	test('a failed delete keeps the dialog open with focus on the confirm button', async () => {
		renderDialog({ onConfirm: () => Promise.reject(new Error('offline')) });
		const confirm = await screen.findByRole('button', { name: 'Delete' });
		confirm.focus();

		await fireEvent.click(confirm);

		const again = await screen.findByRole('button', { name: 'Delete' });
		expect(again).toBe(confirm);
		expect(document.activeElement).toBe(confirm);
		expect(screen.getByRole('alertdialog')).toBeInTheDocument();
	});
});
