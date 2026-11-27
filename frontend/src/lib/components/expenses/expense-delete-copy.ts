import { EXPENSE_CATEGORY_INFO } from '#lib/constants/expense-categories.ts';
import { formatCurrency, formatDate } from '#lib/utils/formatters.ts';
import { getVehicleDisplayName } from '#lib/utils/vehicle-helpers.ts';
import type { Expense, Vehicle } from '#lib/types/index.ts';

export const DELETE_TITLE = 'Delete expense?';

export function expenseName(expense: Pick<Expense, 'description' | 'category'>): string {
	return expense.description?.trim() || EXPENSE_CATEGORY_INFO[expense.category].shortLabel;
}

export function deleteDescription(
	expense: Expense,
	vehicle: Vehicle | null | undefined,
	kind: 'single' | 'split' | 'insurance' = 'single'
): string {
	const owner = vehicle && kind === 'single' ? ` for ${getVehicleDisplayName(vehicle)}` : '';
	const day = formatDate(new Date(expense.date));
	const amount = kind === 'single' ? expense.amount : (expense.groupTotal ?? expense.amount);
	const lead = `“${expenseName(expense)}”${owner}, ${formatCurrency(amount, expense.currency)} on ${day}.`;
	const scope =
		kind === 'insurance'
			? ' This deletes the whole insurance group and every expense in it.'
			: kind === 'split'
				? " It's a split expense, so every vehicle's share is deleted."
				: '';
	return `${lead}${scope} Its photos and receipts go too. You can undo it for 5 seconds.`;
}
