import type { Expense, ExpenseCategory, Vehicle } from '$lib/types';
import {
	compareExpenseRows,
	type SortDirection,
	type SortableRow
} from '$lib/utils/expense-helpers';
import { getVehicleDisplayName } from '$lib/utils/vehicle-helpers';

export interface ExpenseRow {
	type: 'standalone';
	expense: Expense;
}

export interface GroupRow {
	type: 'group';
	groupId: string;
	totalAmount: number;
	category: ExpenseCategory;
	date: string;
	description: string | undefined;
	tags: string[];
	vehicleNames: string[];
	children: Expense[];
}

export type DisplayRow = ExpenseRow | GroupRow;

export type SortField = 'date' | 'amount';

export interface SortOptions {
	sortBy: SortField;
	sortOrder: SortDirection;
}

export interface VisibleExpenseOptions extends SortOptions {
	categoryFilter: string;
	filterByCategory: boolean;
	sortLocally: boolean;
}

export function visibleExpenses(
	expenses: readonly Expense[],
	options: VisibleExpenseOptions
): Expense[] {
	let filtered = [...expenses];

	if (options.filterByCategory && options.categoryFilter) {
		filtered = filtered.filter(e => e.category === options.categoryFilter);
	}

	if (!options.sortLocally) return filtered;

	filtered.sort((a, b) => compareExpenseRows(a, b, options.sortBy, options.sortOrder));
	return filtered;
}

export function buildDisplayRows(
	expenses: readonly Expense[],
	vehicleMap: ReadonlyMap<string, Vehicle>,
	sort: SortOptions
): DisplayRow[] {
	const grouped = new Map<string, Expense[]>();
	const standalone: Expense[] = [];

	for (const expense of expenses) {
		if (expense.groupId) {
			const existing = grouped.get(expense.groupId);
			if (existing) {
				existing.push(expense);
			} else {
				grouped.set(expense.groupId, [expense]);
			}
		} else {
			standalone.push(expense);
		}
	}

	const rows: DisplayRow[] = [];

	for (const expense of standalone) {
		rows.push({ type: 'standalone' as const, expense });
	}

	for (const [groupId, children] of grouped) {
		const first = children[0];
		if (!first) continue;
		const totalAmount = Math.round(children.reduce((sum, c) => sum + c.amount, 0) * 100) / 100;

		const vehicleNameSet = new Set<string>();
		for (const child of children) {
			const v = vehicleMap.get(child.vehicleId);
			if (v) vehicleNameSet.add(getVehicleDisplayName(v));
		}
		rows.push({
			type: 'group' as const,
			groupId,
			totalAmount,
			category: first.category,
			date: first.date,
			description: first.description,
			tags: first.tags || [],
			vehicleNames: [...vehicleNameSet],
			children
		});
	}

	rows.sort((a, b) => {
		const rowA: SortableRow =
			a.type === 'standalone'
				? a.expense
				: { id: a.children[0]?.id ?? a.groupId, date: a.date, amount: a.totalAmount };
		const rowB: SortableRow =
			b.type === 'standalone'
				? b.expense
				: { id: b.children[0]?.id ?? b.groupId, date: b.date, amount: b.totalAmount };
		return compareExpenseRows(rowA, rowB, sort.sortBy, sort.sortOrder);
	});

	return rows;
}

export function rowKey(row: DisplayRow): string {
	return row.type === 'standalone' ? row.expense.id : row.groupId;
}
